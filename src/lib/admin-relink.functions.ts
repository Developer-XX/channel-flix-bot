// Admin action: re-run the telegram_file_unique_id self-heal for media_files
// rows stuck in source_missing or marked superseded_by_resend. The browser-side
// admin page calls relinkStaleMediaSources(), which loads candidates from
// download_logs + media_files and invokes the same tryRelinkByIngest helper
// used by the live download flow.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { tryRelinkByIngest } from "@/lib/downloads.functions";

const SUPERSEDED_REASONS = ["superseded_by_resend", "superseded_by_source_relink"];

const Input = z
  .object({
    mediaFileId: z.string().uuid().optional(),
    lookbackHours: z.number().int().min(1).max(24 * 60).optional(),
    limit: z.number().int().min(1).max(500).optional(),
    includeSuperseded: z.boolean().optional(),
    reactivateOnRelink: z.boolean().optional(),
  })
  .default({});

type Outcome = {
  media_file_id: string;
  source: "source_missing" | "superseded" | "manual";
  before: {
    telegram_message_id: number | null;
    telegram_file_unique_id: string | null;
    channel_id: string | null;
    is_active: boolean | null;
    deleted_reason: string | null;
  };
  relinked: boolean;
  reactivated: boolean;
  after?: {
    telegram_message_id: number | null;
    telegram_file_unique_id: string | null;
    channel_id: string | null;
  };
  error?: string;
};

export const relinkStaleMediaSources = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input ?? {}))
  .handler(async ({ context, data }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const limit = data.limit ?? 100;
    const lookbackHours = data.lookbackHours ?? 24 * 7;
    const includeSuperseded = data.includeSuperseded ?? true;
    const reactivateOnRelink = data.reactivateOnRelink ?? true;

    const candidateIds = new Map<string, Outcome["source"]>();

    if (data.mediaFileId) {
      candidateIds.set(data.mediaFileId, "manual");
    } else {
      // 1. source_missing from download_logs (last N hours)
      const since = new Date(Date.now() - lookbackHours * 3600_000).toISOString();
      const { data: smRows } = await supabaseAdmin
        .from("download_logs")
        .select("file_id, created_at")
        .eq("failure_reason", "source_missing")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1000);
      for (const r of smRows ?? []) {
        if (r.file_id && !candidateIds.has(r.file_id)) candidateIds.set(r.file_id, "source_missing");
        if (candidateIds.size >= limit) break;
      }

      // 2. superseded media_files (inactive with the resend reason)
      if (includeSuperseded && candidateIds.size < limit) {
        const { data: spRows } = await supabaseAdmin
          .from("media_files")
          .select("id")
          .in("deleted_reason", SUPERSEDED_REASONS)
          .order("updated_at", { ascending: false })
          .limit(limit);
        for (const r of spRows ?? []) {
          if (r.id && !candidateIds.has(r.id)) candidateIds.set(r.id, "superseded");
          if (candidateIds.size >= limit) break;
        }
      }
    }

    const outcomes: Outcome[] = [];
    for (const [mediaFileId, source] of candidateIds) {
      const { data: before } = await supabaseAdmin
        .from("media_files")
        .select(
          "id, title_id, episode_id, resolution, language, telegram_message_id, telegram_file_unique_id, channel_id, is_active, deleted_reason",
        )
        .eq("id", mediaFileId)
        .maybeSingle();
      if (!before) {
        outcomes.push({
          media_file_id: mediaFileId,
          source,
          before: {
            telegram_message_id: null,
            telegram_file_unique_id: null,
            channel_id: null,
            is_active: null,
            deleted_reason: null,
          },
          relinked: false,
          reactivated: false,
          error: "media_file_not_found",
        });
        continue;
      }

      let relinked = false;
      let errorMsg: string | undefined;
      try {
        relinked = await tryRelinkByIngest(supabaseAdmin, {
          mediaFileId,
          telegramFileUniqueId: before.telegram_file_unique_id ?? null,
          channelRowId: before.channel_id ?? null,
          episodeId: before.episode_id ?? null,
          titleId: before.title_id ?? null,
          resolution: before.resolution ?? null,
          language: before.language ?? null,
          currentMessageId: before.telegram_message_id ?? null,
        });
      } catch (e) {
        errorMsg = (e as Error).message;
      }

      let reactivated = false;
      if (relinked && reactivateOnRelink && before.is_active === false) {
        const { error: reactErr } = await supabaseAdmin
          .from("media_files")
          .update({
            is_active: true,
            deleted_at: null,
            deleted_by: null,
            deleted_reason: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", mediaFileId);
        if (!reactErr) reactivated = true;
        else errorMsg = errorMsg ?? reactErr.message;
      }

      let after: Outcome["after"];
      if (relinked) {
        const { data: refreshed } = await supabaseAdmin
          .from("media_files")
          .select("telegram_message_id, telegram_file_unique_id, channel_id")
          .eq("id", mediaFileId)
          .maybeSingle();
        if (refreshed)
          after = {
            telegram_message_id: refreshed.telegram_message_id ?? null,
            telegram_file_unique_id: refreshed.telegram_file_unique_id ?? null,
            channel_id: refreshed.channel_id ?? null,
          };
      }

      const outcome: Outcome = {
        media_file_id: mediaFileId,
        source,
        before: {
          telegram_message_id: before.telegram_message_id ?? null,
          telegram_file_unique_id: before.telegram_file_unique_id ?? null,
          channel_id: before.channel_id ?? null,
          is_active: before.is_active ?? null,
          deleted_reason: before.deleted_reason ?? null,
        },
        relinked,
        reactivated,
        after,
        error: errorMsg,
      };
      outcomes.push(outcome);

      try {
        await supabaseAdmin.from("admin_audit_log").insert({
          actor_user_id: context.userId,
          action: "media_relink_stale_source",
          target_kind: "media_file",
          target_id: mediaFileId,
          details: outcome as never,
        });
      } catch {
        // audit log is best-effort
      }
    }

    return {
      considered: candidateIds.size,
      relinked: outcomes.filter((o) => o.relinked).length,
      reactivated: outcomes.filter((o) => o.reactivated).length,
      errors: outcomes.filter((o) => o.error).length,
      outcomes,
    };
  });
