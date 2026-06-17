import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminAccess } from "@/lib/admin-auth";

const CATEGORY = z.enum(["movie", "series", "anime", "cartoon", "kdrama", "documentary"]);

// Soft-delete retention. After this window, hard-delete runs lazily on list calls.
const SOFT_DELETE_RETENTION_MS = 24 * 60 * 60 * 1000;

function reqMeta() {
  return {
    ip: getRequestHeader("x-forwarded-for") ?? getRequestHeader("cf-connecting-ip") ?? null,
    ua: getRequestHeader("user-agent") ?? null,
  };
}

async function writeAdminAudit(
  ctx: { userId: string; claims: any },
  action: string,
  status: "success" | "failed" | "rejected" | "pending",
  metadata: Record<string, unknown> = {},
) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const meta = reqMeta();
    await supabaseAdmin.from("admin_audit_log").insert({
      actor_user_id: ctx.userId,
      actor_email: (ctx.claims as { email?: string } | null)?.email ?? null,
      action,
      status,
      ip: meta.ip,
      user_agent: meta.ua,
      metadata,
    } as never);
  } catch (e) {
    console.warn("[admin-audit] insert failed", (e as Error).message);
  }
}

// Lazy hard-delete of soft-deleted rows whose retention window has expired.
async function purgeExpiredSoftDeletes() {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cutoff = new Date(Date.now() - SOFT_DELETE_RETENTION_MS).toISOString();
    await supabaseAdmin.from("media_files").delete().lt("deleted_at", cutoff).not("deleted_at", "is", null);
    await supabaseAdmin.from("telegram_ingest").delete().lt("deleted_at", cutoff).not("deleted_at", "is", null);
  } catch (e) {
    console.warn("[purgeExpiredSoftDeletes] failed", (e as Error).message);
  }
}

const IngestFiltersSchema = z.object({
  status: z.enum(["pending", "matched", "unmatched", "ignored", "all"]).optional(),
  trash: z.boolean().optional(),
  q: z.string().max(200).optional(),
  channelId: z.string().uuid().optional(),
  quality: z.string().max(40).optional(),
  language: z.string().max(100).optional(),
  season: z.number().int().min(0).max(99).nullable().optional(),
  episode: z.number().int().min(0).max(999).nullable().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

export const listTelegramIngest = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => IngestFiltersSchema.parse(d ?? {}))
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    await purgeExpiredSoftDeletes();
    let q = context.supabase
      .from("telegram_ingest")
      .select(
        "id, channel_id, telegram_channel_id, telegram_message_id, file_name, caption, mime_type, file_size, duration_seconds, parsed_title, parsed_year, parsed_season, parsed_episode, parsed_resolution, parsed_quality, parsed_codec, parsed_language, parsed_category, match_status, matched_title_id, match_score, promoted_media_file_id, last_error, created_at, deleted_at",
      )
      .order("created_at", { ascending: false })
      .limit(500);
    if (data.trash) {
      const cutoff = new Date(Date.now() - SOFT_DELETE_RETENTION_MS).toISOString();
      q = q.not("deleted_at", "is", null).gte("deleted_at", cutoff);
    } else {
      q = q.is("deleted_at", null);
    }
    if (data.status && data.status !== "all") q = q.eq("match_status", data.status);
    if (data.channelId) q = q.eq("channel_id", data.channelId);
    if (data.quality) q = q.ilike("parsed_quality", `%${data.quality}%`);
    if (data.language) q = q.ilike("parsed_language", `%${data.language}%`);
    if (data.season != null) q = q.eq("parsed_season", data.season);
    if (data.episode != null) q = q.eq("parsed_episode", data.episode);
    if (data.dateFrom) q = q.gte("created_at", data.dateFrom);
    if (data.dateTo) q = q.lte("created_at", data.dateTo);
    if (data.q && data.q.trim()) {
      const term = data.q.trim().replace(/[%_]/g, "");
      q = q.or(
        `file_name.ilike.%${term}%,parsed_title.ilike.%${term}%,caption.ilike.%${term}%`,
      );
    }
    const { data: rows, error } = await q;
    if (error) throw error;
    return rows ?? [];
  });


// Edit parsed metadata corrections before promotion.
export const updateIngest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        ingestId: z.string().uuid(),
        parsed_title: z.string().min(1).max(300).optional(),
        parsed_year: z.number().int().min(1900).max(2100).nullable().optional(),
        parsed_season: z.number().int().min(0).max(99).nullable().optional(),
        parsed_episode: z.number().int().min(0).max(999).nullable().optional(),
        parsed_resolution: z.string().max(20).nullable().optional(),
        parsed_quality: z.string().max(40).nullable().optional(),
        parsed_codec: z.string().max(20).nullable().optional(),
        parsed_language: z.string().max(100).nullable().optional(),
        parsed_category: CATEGORY.nullable().optional(),
        matched_title_id: z.string().uuid().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { ingestId, ...patch } = data;
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) cleaned[k] = v;
    if (Object.keys(cleaned).length === 0) return { ok: true };
    const { error } = await context.supabase
      .from("telegram_ingest")
      .update(cleaned as never)
      .eq("id", ingestId);
    if (error) throw error;
    return { ok: true };
  });

export const promoteIngest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        ingestId: z.string().uuid(),
        titleId: z.string().uuid(),
        episodeId: z.string().uuid().nullish(),
        overrides: z
          .object({
            file_name: z.string().min(1).max(300).optional(),
            quality: z.string().max(40).nullable().optional(),
            resolution: z.string().max(20).nullable().optional(),
            language: z.string().max(100).nullable().optional(),
          })
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: ingest, error: e1 } = await supabaseAdmin
      .from("telegram_ingest")
      .select("*")
      .eq("id", data.ingestId)
      .maybeSingle();
    if (e1) throw e1;
    if (!ingest) throw new Error("Ingest row not found");
    if (!ingest.telegram_file_id) throw new Error("Missing telegram_file_id");

    const ov = data.overrides ?? {};
    const { data: file, error: e2 } = await supabaseAdmin
      .from("media_files")
      .upsert(
        {
          title_id: data.titleId,
          episode_id: data.episodeId ?? null,
          channel_id: ingest.channel_id,
          telegram_file_id: ingest.telegram_file_id,
          telegram_message_id: ingest.telegram_message_id,
          file_name: ov.file_name ?? ingest.file_name ?? ingest.parsed_title ?? "file",
          caption: ingest.caption,
          file_size: ingest.file_size,
          mime_type: ingest.mime_type,
          quality: ov.quality ?? ingest.parsed_quality,
          resolution: ov.resolution ?? ingest.parsed_resolution,
          language: ov.language ?? ingest.parsed_language,
          duration_seconds: ingest.duration_seconds,
          is_active: true,
        },
        { onConflict: "telegram_file_id" },
      )
      .select("id")
      .single();
    if (e2) throw e2;

    const { error: e3 } = await supabaseAdmin
      .from("telegram_ingest")
      .update({
        match_status: "matched",
        matched_title_id: data.titleId,
        promoted_media_file_id: file.id,
        last_error: null,
      })
      .eq("id", data.ingestId);
    if (e3) throw e3;
    return { ok: true, fileId: file.id };
  });

export const ignoreIngest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ingestId: string }) =>
    z.object({ ingestId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { error } = await context.supabase
      .from("telegram_ingest")
      .update({ match_status: "ignored" })
      .eq("id", data.ingestId);
    if (error) throw error;
    return { ok: true };
  });

// Admin-only: SOFT-delete selected ingest rows (and any media_files promoted
// from them). Rows remain recoverable for 24 hours via restoreIngestRows.
export const deleteIngestRows = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      ingestIds: z.array(z.string().uuid()).min(1).max(500),
      reason: z.string().max(200).optional(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = new Date().toISOString();
    const { data: rows } = await supabaseAdmin
      .from("telegram_ingest")
      .select("id, promoted_media_file_id, file_name, parsed_title")
      .in("id", data.ingestIds);
    const mediaIds = (rows ?? [])
      .map((r: any) => r.promoted_media_file_id)
      .filter(Boolean) as string[];
    if (mediaIds.length) {
      await supabaseAdmin
        .from("media_files")
        .update({ deleted_at: now, deleted_by: context.userId, deleted_reason: data.reason ?? "admin_bulk_delete", is_active: false } as never)
        .in("id", mediaIds);
    }
    const { error } = await supabaseAdmin
      .from("telegram_ingest")
      .update({ deleted_at: now, deleted_by: context.userId, deleted_reason: data.reason ?? "admin_bulk_delete" } as never)
      .in("id", data.ingestIds);
    if (error) throw error;
    await writeAdminAudit(context, "telegram.delete_selected", "success", {
      count: data.ingestIds.length,
      mediaCount: mediaIds.length,
      reason: data.reason ?? null,
      ids: data.ingestIds.slice(0, 50),
      sampleNames: (rows ?? []).slice(0, 10).map((r: any) => r.file_name ?? r.parsed_title),
    });
    return { ok: true, deletedIngest: data.ingestIds.length, deletedMedia: mediaIds.length, recoverable_until: new Date(Date.now() + SOFT_DELETE_RETENTION_MS).toISOString() };
  });

// Admin-only: SOFT-wipe ALL ingest rows + media_files. Same confirmation phrase.
// Reversible within 24h via the Trash tab.
export const deleteAllIngest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ confirm: z.literal("DELETE ALL FILES") }).parse(d),
  )
  .handler(async ({ context }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = new Date().toISOString();
    const [{ count: mf }, { count: ig }] = await Promise.all([
      supabaseAdmin.from("media_files").select("id", { count: "exact", head: true }).is("deleted_at", null),
      supabaseAdmin.from("telegram_ingest").select("id", { count: "exact", head: true }).is("deleted_at", null),
    ]);
    await supabaseAdmin
      .from("media_files")
      .update({ deleted_at: now, deleted_by: context.userId, deleted_reason: "admin_delete_all", is_active: false } as never)
      .is("deleted_at", null);
    await supabaseAdmin
      .from("telegram_ingest")
      .update({ deleted_at: now, deleted_by: context.userId, deleted_reason: "admin_delete_all" } as never)
      .is("deleted_at", null);
    await writeAdminAudit(context, "telegram.delete_all", "success", {
      mediaCount: mf ?? 0,
      ingestCount: ig ?? 0,
      confirmation: "DELETE ALL FILES",
      recoverable_until: new Date(Date.now() + SOFT_DELETE_RETENTION_MS).toISOString(),
    });
    return { ok: true, deletedMedia: mf ?? 0, deletedIngest: ig ?? 0, recoverable_until: new Date(Date.now() + SOFT_DELETE_RETENTION_MS).toISOString() };
  });

// Restore soft-deleted ingest rows (and their promoted media files) within the
// 24h retention window.
export const restoreIngestRows = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ ingestIds: z.array(z.string().uuid()).min(1).max(500) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("telegram_ingest")
      .select("id, promoted_media_file_id, deleted_at")
      .in("id", data.ingestIds);
    const cutoff = Date.now() - SOFT_DELETE_RETENTION_MS;
    const restorable = (rows ?? []).filter(
      (r: any) => r.deleted_at && new Date(r.deleted_at).getTime() >= cutoff,
    );
    const restorableIds = restorable.map((r: any) => r.id);
    const mediaIds = restorable.map((r: any) => r.promoted_media_file_id).filter(Boolean) as string[];
    if (mediaIds.length) {
      await supabaseAdmin
        .from("media_files")
        .update({ deleted_at: null, deleted_by: null, deleted_reason: null, is_active: true } as never)
        .in("id", mediaIds);
    }
    if (restorableIds.length) {
      await supabaseAdmin
        .from("telegram_ingest")
        .update({ deleted_at: null, deleted_by: null, deleted_reason: null } as never)
        .in("id", restorableIds);
    }
    await writeAdminAudit(context, "telegram.restore", "success", {
      restored: restorableIds.length,
      skipped: data.ingestIds.length - restorableIds.length,
    });
    return { ok: true, restored: restorableIds.length, skipped: data.ingestIds.length - restorableIds.length };
  });

// Resync (re-scan) selected channels and re-populate any missing parsed
// metadata on existing ingest rows without duplicating them (unique by
// telegram_channel_id+telegram_message_id). Also runs the global backfill loop.
export const resyncChannels = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ channelIds: z.array(z.string().uuid()).min(1).max(50) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { parseMedia } = await import("@/lib/telegram-parser");
    const { runTelegramBackfill } = await import("@/lib/telegram-backfill.server");

    // 1) Re-parse any existing rows with missing metadata for these channels.
    const { data: rows } = await supabaseAdmin
      .from("telegram_ingest")
      .select("id, caption, file_name, parsed_title, parsed_year, parsed_season, parsed_episode, parsed_resolution, parsed_quality, parsed_codec, parsed_language, parsed_category")
      .in("channel_id", data.channelIds)
      .is("deleted_at", null)
      .limit(2000);
    let updated = 0;
    for (const r of rows ?? []) {
      const parsed = parseMedia(r.caption, r.file_name);
      const patch: Record<string, unknown> = {};
      const setIfEmpty = (key: string, current: unknown, next: unknown) => {
        if ((current === null || current === undefined || current === "") && next != null && next !== "") {
          patch[key] = next;
        }
      };
      setIfEmpty("parsed_title", r.parsed_title, parsed.title);
      setIfEmpty("parsed_year", r.parsed_year, parsed.year);
      setIfEmpty("parsed_season", r.parsed_season, parsed.season);
      setIfEmpty("parsed_episode", r.parsed_episode, parsed.episode);
      setIfEmpty("parsed_resolution", r.parsed_resolution, parsed.resolution);
      setIfEmpty("parsed_quality", r.parsed_quality, parsed.quality);
      setIfEmpty("parsed_codec", r.parsed_codec, parsed.codec);
      setIfEmpty("parsed_language", r.parsed_language, parsed.language);
      setIfEmpty("parsed_category", r.parsed_category, parsed.category);
      if (Object.keys(patch).length) {
        await supabaseAdmin.from("telegram_ingest").update(patch as never).eq("id", r.id);
        updated++;
      }
    }

    // 2) Run the global backfill loop to pull new posts (uniqueness enforced
    // by the (telegram_channel_id, telegram_message_id) constraint).
    const bf = await runTelegramBackfill();

    await writeAdminAudit(context, "telegram.resync_channels", "success", {
      channelIds: data.channelIds,
      scanned: rows?.length ?? 0,
      metadataUpdated: updated,
      backfillProcessed: bf.processed,
    });

    return {
      ok: true,
      scanned: rows?.length ?? 0,
      metadataUpdated: updated,
      backfillProcessed: bf.processed,
      newLastUpdateId: bf.newLastUpdateId,
    };
  });


export const searchMasterTitles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { q: string }) => z.object({ q: z.string().max(200) }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const q = data.q.trim();
    if (!q) return [];
    const { data: rows, error } = await context.supabase
      .from("master_titles")
      .select("id, title, release_year, category")
      .ilike("title", `%${q}%`)
      .limit(20);
    if (error) throw error;
    return rows ?? [];
  });

// Convenience: set the Telegram bot webhook URL to point at this deployment.
export const setTelegramWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { baseUrl: string }) =>
    z.object({ baseUrl: z.string().url() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
    if (!secret) throw new Error("TELEGRAM_WEBHOOK_SECRET is not configured");
    const url = `${data.baseUrl.replace(/\/$/, "")}/api/public/telegram/webhook`;
    const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        secret_token: secret,
        allowed_updates: ["channel_post", "edited_channel_post", "message", "edited_message"],
      }),
    });
    const body = await res.json();
    if (!res.ok || !body.ok) throw new Error(`Telegram setWebhook failed: ${JSON.stringify(body)}`);
    return { ok: true, url, result: body.result };
  });

export const getTelegramWebhookInfo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminAccess(context);
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
    const res = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    const body = await res.json();
    if (!res.ok || !body.ok)
      throw new Error(`Telegram getWebhookInfo failed: ${JSON.stringify(body)}`);
    return body.result;
  });

export const runBackfillNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminAccess(context);
    const { runTelegramBackfill } = await import("@/lib/telegram-backfill.server");
    return runTelegramBackfill();
  });

export const getBotState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminAccess(context);
    const { data, error } = await context.supabase
      .from("telegram_bot_state")
      .select("last_update_id, last_run_at, last_run_status, last_run_error, admin_telegram_user_ids")
      .eq("id", "global")
      .maybeSingle();
    if (error) throw error;
    return data;
  });

// --- Channel wizard -----------------------------------------------------

export const listTelegramChannels = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminAccess(context);
    const { data, error } = await context.supabase
      .from("telegram_channels")
      .select("id, channel_id, name, username, description, is_active, confirm_with_reply, last_synced_at, created_at")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data ?? [];
  });

export const verifyTelegramChannel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ref: string }) => z.object({ ref: z.string().min(1).max(120) }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { getChat, getChatMember, getMe } = await import("@/lib/telegram-api.server");
    let ref: string | number = data.ref.trim();
    if (/^-?\d+$/.test(ref)) ref = Number(ref);
    else if (!ref.startsWith("@")) ref = `@${ref}`;

    try {
      const [chat, me] = await Promise.all([getChat(ref), getMe()]);
      let isAdmin = false;
      let canRead = false;
      let memberStatus = "unknown";
      try {
        const m = await getChatMember(chat.id, me.id);
        memberStatus = m.status;
        isAdmin = m.status === "administrator" || m.status === "creator";
        // For channels Telegram requires the bot to be an admin to receive
        // channel_post updates at all; can_post is optional for read-only.
        canRead = isAdmin;
      } catch (e: any) {
        memberStatus = `error: ${e.message}`;
      }
      return {
        ok: true as const,
        chat: {
          id: chat.id,
          type: chat.type,
          title: chat.title ?? null,
          username: chat.username ?? null,
          description: chat.description ?? null,
        },
        bot: { id: me.id, username: me.username ?? null },
        isAdmin,
        canRead,
        memberStatus,
      };
    } catch (e: any) {
      return { ok: false as const, error: e.message };
    }
  });

export const saveTelegramChannel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      channel_id: z.number().int(),
      name: z.string().min(1).max(200),
      username: z.string().max(64).nullable().optional(),
      description: z.string().max(2000).nullable().optional(),
      is_active: z.boolean().optional(),
      confirm_with_reply: z.boolean().optional(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("telegram_channels")
      .upsert(
        {
          channel_id: data.channel_id,
          name: data.name,
          username: data.username ?? null,
          description: data.description ?? null,
          is_active: data.is_active ?? true,
          confirm_with_reply: data.confirm_with_reply ?? false,
        },
        { onConflict: "channel_id" },
      );
    if (error) throw error;
    return { ok: true };
  });

export const deleteTelegramChannel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { error } = await context.supabase.from("telegram_channels").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const setBotAdminIds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ids: number[] }) =>
    z.object({ ids: z.array(z.number().int()).max(50) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("telegram_bot_state")
      .upsert({ id: "global", admin_telegram_user_ids: data.ids }, { onConflict: "id" });
    if (error) throw error;
    return { ok: true };
  });

// --- Title aliases ------------------------------------------------------
// Aliases let admins map free-form caption text (e.g. "Shaktimaan Animation")
// to a published master_title. The Telegram ingest pipeline checks aliases
// first when deciding which title an incoming file belongs to.

export const listTitleAliases = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { titleId?: string }) =>
    z.object({ titleId: z.string().uuid().optional() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    let q = context.supabase
      .from("title_aliases")
      .select("id, title_id, alias, normalized_alias, created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (data.titleId) q = q.eq("title_id", data.titleId);
    const { data: rows, error } = await q;
    if (error) throw error;
    return rows ?? [];
  });

export const addTitleAlias = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { titleId: string; alias: string }) =>
    z.object({
      titleId: z.string().uuid(),
      alias: z.string().min(1).max(200),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { normalizeTitle } = await import("@/lib/telegram-parser");
    const normalized = normalizeTitle(data.alias);
    if (!normalized) throw new Error("Alias is empty after normalization");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("title_aliases")
      .upsert(
        { title_id: data.titleId, alias: data.alias.trim(), normalized_alias: normalized },
        { onConflict: "title_id,normalized_alias" },
      );
    if (error) throw error;
    return { ok: true };
  });

export const deleteTitleAlias = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("title_aliases").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

// Re-run the matcher (alias + fuzzy) against every unmatched ingest row and
// auto-promote any that now resolve to a master_title. Respects the saved
// matching_settings. Optionally targets a specific set of ingestIds.
export const rematchUnmatched = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ ingestIds: z.array(z.string().uuid()).optional() }).parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runMatcher, loadMatchingSettings, autoPromoteToMediaFile } = await import("@/lib/telegram-ingest.server");

    const settings = await loadMatchingSettings(supabaseAdmin);
    let q = supabaseAdmin
      .from("telegram_ingest")
      .select("*")
      .is("promoted_media_file_id", null)
      .limit(1000);
    if (data.ingestIds && data.ingestIds.length) q = q.in("id", data.ingestIds);
    else q = q.eq("match_status", "unmatched");
    const { data: rows, error } = await q;
    if (error) throw error;

    let promoted = 0;
    let stillUnmatched = 0;

    for (const r of rows ?? []) {
      if (!r.telegram_file_id) { stillUnmatched++; continue; }
      const match = await runMatcher(
        supabaseAdmin,
        { title: r.parsed_title ?? "", year: r.parsed_year ?? null, category: r.parsed_category ?? null },
        settings,
      );
      if (!match.matchedTitleId) {
        await supabaseAdmin
          .from("telegram_ingest")
          .update({ match_score: match.matchScore })
          .eq("id", r.id);
        stillUnmatched++;
        continue;
      }
      try {
        await autoPromoteToMediaFile(supabaseAdmin, {
          ingestId: r.id,
          titleId: match.matchedTitleId,
          channelRowId: r.channel_id,
          telegramFileId: r.telegram_file_id,
          telegramMessageId: r.telegram_message_id,
          fileName: r.file_name ?? r.parsed_title ?? "file",
          caption: r.caption,
          mimeType: r.mime_type,
          fileSize: r.file_size,
          durationSeconds: r.duration_seconds,
          quality: r.parsed_quality,
          resolution: r.parsed_resolution,
          language: r.parsed_language,
          season: r.parsed_season,
          episode: r.parsed_episode,
        });
        promoted++;
      } catch (e) {
        console.warn("rematch promote failed", r.id, (e as Error).message);
        stillUnmatched++;
      }
    }
    return { ok: true, promoted, stillUnmatched, scanned: rows?.length ?? 0 };
  });

// --- Matching settings -------------------------------------------------

export const getMatchingSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminAccess(context);
    const { loadMatchingSettings } = await import("@/lib/telegram-ingest.server");
    return loadMatchingSettings(context.supabase);
  });

export const updateMatchingSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      threshold: z.number().min(0).max(1),
      use_aliases: z.boolean(),
      use_substring: z.boolean(),
      use_containment: z.boolean(),
      use_jaccard: z.boolean(),
      year_window: z.number().int().min(0).max(10),
      require_category_match: z.boolean(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("telegram_bot_state")
      .upsert({ id: "global", matching_settings: data as any }, { onConflict: "id" });
    if (error) throw error;
    return { ok: true };
  });

// --- Diagnostics & per-row rematch -------------------------------------

export const diagnoseIngest = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ingestId: string }) => z.object({ ingestId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { runMatcher, loadMatchingSettings } = await import("@/lib/telegram-ingest.server");
    const { data: row, error } = await context.supabase
      .from("telegram_ingest")
      .select("parsed_title, parsed_year, parsed_category, parsed_season, parsed_episode, parsed_resolution, parsed_quality, parsed_language, file_name, caption")
      .eq("id", data.ingestId)
      .maybeSingle();
    if (error) throw error;
    if (!row) throw new Error("Ingest row not found");
    const settings = await loadMatchingSettings(context.supabase);
    const result = await runMatcher(
      context.supabase,
      { title: row.parsed_title ?? "", year: row.parsed_year ?? null, category: row.parsed_category ?? null },
      settings,
    );
    return { ...result, parsed: row, settings };
  });

export const rematchOne = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ingestId: string; autoPromote?: boolean }) =>
    z.object({ ingestId: z.string().uuid(), autoPromote: z.boolean().optional() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runMatcher, loadMatchingSettings, autoPromoteToMediaFile } = await import("@/lib/telegram-ingest.server");
    const { data: r, error } = await supabaseAdmin
      .from("telegram_ingest").select("*").eq("id", data.ingestId).maybeSingle();
    if (error) throw error;
    if (!r) throw new Error("Ingest row not found");
    const settings = await loadMatchingSettings(supabaseAdmin);
    const match = await runMatcher(
      supabaseAdmin,
      { title: r.parsed_title ?? "", year: r.parsed_year ?? null, category: r.parsed_category ?? null },
      settings,
    );
    await supabaseAdmin.from("telegram_ingest").update({
      match_status: match.matchedTitleId ? "matched" : "unmatched",
      matched_title_id: match.matchedTitleId,
      match_score: match.matchScore,
    }).eq("id", r.id);

    let promoted = false;
    if (data.autoPromote !== false && match.matchedTitleId && r.telegram_file_id) {
      await autoPromoteToMediaFile(supabaseAdmin, {
        ingestId: r.id,
        titleId: match.matchedTitleId,
        channelRowId: r.channel_id,
        telegramFileId: r.telegram_file_id,
        telegramMessageId: r.telegram_message_id,
        fileName: r.file_name ?? r.parsed_title ?? "file",
        caption: r.caption,
        mimeType: r.mime_type,
        fileSize: r.file_size,
        durationSeconds: r.duration_seconds,
        quality: r.parsed_quality,
        resolution: r.parsed_resolution,
        language: r.parsed_language,
        season: r.parsed_season,
        episode: r.parsed_episode,
      });
      promoted = true;
    }
    return { ok: true, match, promoted };
  });

// --- Bulk actions ------------------------------------------------------

export const bulkAssignTitle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ingestIds: string[]; titleId: string; promote?: boolean }) =>
    z.object({
      ingestIds: z.array(z.string().uuid()).min(1).max(500),
      titleId: z.string().uuid(),
      promote: z.boolean().optional(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { autoPromoteToMediaFile } = await import("@/lib/telegram-ingest.server");
    let promoted = 0;
    const { data: rows, error } = await supabaseAdmin
      .from("telegram_ingest").select("*").in("id", data.ingestIds);
    if (error) throw error;
    for (const r of rows ?? []) {
      await supabaseAdmin.from("telegram_ingest").update({
        matched_title_id: data.titleId, match_status: "matched", match_score: 1.0,
      }).eq("id", r.id);
      if (data.promote !== false && r.telegram_file_id) {
        try {
          await autoPromoteToMediaFile(supabaseAdmin, {
            ingestId: r.id, titleId: data.titleId, channelRowId: r.channel_id,
            telegramFileId: r.telegram_file_id, telegramMessageId: r.telegram_message_id,
            fileName: r.file_name ?? r.parsed_title ?? "file", caption: r.caption,
            mimeType: r.mime_type, fileSize: r.file_size, durationSeconds: r.duration_seconds,
            quality: r.parsed_quality, resolution: r.parsed_resolution,
            language: r.parsed_language, season: r.parsed_season, episode: r.parsed_episode,
          });
          promoted++;
        } catch (e) { console.warn("bulk promote failed", r.id, (e as Error).message); }
      }
    }
    return { ok: true, promoted, assigned: rows?.length ?? 0 };
  });

export const bulkAddAlias = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ingestIds: string[]; titleId: string }) =>
    z.object({
      ingestIds: z.array(z.string().uuid()).min(1).max(500),
      titleId: z.string().uuid(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { normalizeTitle } = await import("@/lib/telegram-parser");
    const { data: rows, error } = await supabaseAdmin
      .from("telegram_ingest").select("id, parsed_title").in("id", data.ingestIds);
    if (error) throw error;
    const seen = new Set<string>();
    let added = 0;
    for (const r of rows ?? []) {
      const alias = r.parsed_title?.trim();
      if (!alias) continue;
      const normalized = normalizeTitle(alias);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      const { error: e2 } = await supabaseAdmin.from("title_aliases").upsert(
        { title_id: data.titleId, alias, normalized_alias: normalized },
        { onConflict: "title_id,normalized_alias" },
      );
      if (!e2) added++;
    }
    return { ok: true, added };
  });


// --- Audit trail, force-rematch, title debug, reindex --------------------

export const getMatchAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ingestId?: string; titleId?: string; limit?: number }) =>
    z.object({
      ingestId: z.string().uuid().optional(),
      titleId: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    let q = context.supabase
      .from("match_audit_log")
      .select("id, telegram_ingest_id, master_title_id, attempt_at, scores, rules_used, threshold, decision, reason, actor, parsed_snapshot")
      .order("attempt_at", { ascending: false })
      .limit(data.limit ?? 50);
    if (data.ingestId) q = q.eq("telegram_ingest_id", data.ingestId);
    if (data.titleId) q = q.eq("master_title_id", data.titleId);
    const { data: rows, error } = await q;
    if (error) throw error;
    return rows ?? [];
  });

export const forceRematchAndPublish = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ingestId: string; assignTitleId?: string }) =>
    z.object({
      ingestId: z.string().uuid(),
      assignTitleId: z.string().uuid().optional(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runMatcher, loadMatchingSettings, autoPromoteToMediaFile } = await import("@/lib/telegram-ingest.server");
    const { writeMatchAudit } = await import("@/lib/match-audit.server");
    const { bumpCacheVersion } = await import("@/lib/indexes.server");

    const { data: r, error } = await supabaseAdmin
      .from("telegram_ingest").select("*").eq("id", data.ingestId).maybeSingle();
    if (error) throw error;
    if (!r) throw new Error("Ingest row not found");

    const settings = await loadMatchingSettings(supabaseAdmin);
    const match = await runMatcher(
      supabaseAdmin,
      { title: r.parsed_title ?? "", year: r.parsed_year ?? null, category: r.parsed_category ?? null },
      settings,
    );

    const finalTitleId = data.assignTitleId ?? match.matchedTitleId;
    const actor = `admin:${context.claims?.email ?? context.userId}`;

    let promoted = false;
    let fileId: string | null = null;
    let reason = "below_threshold";

    if (finalTitleId && r.telegram_file_id) {
      try {
        fileId = await autoPromoteToMediaFile(supabaseAdmin, {
          ingestId: r.id,
          titleId: finalTitleId,
          channelRowId: r.channel_id,
          telegramFileId: r.telegram_file_id,
          telegramMessageId: r.telegram_message_id,
          fileName: r.file_name ?? r.parsed_title ?? "file",
          caption: r.caption,
          mimeType: r.mime_type,
          fileSize: r.file_size,
          durationSeconds: r.duration_seconds,
          quality: r.parsed_quality,
          resolution: r.parsed_resolution,
          language: r.parsed_language,
          season: r.parsed_season,
          episode: r.parsed_episode,
        });
        promoted = true;
        reason = data.assignTitleId ? "manual_assign" : (match.matchedVia ?? "fuzzy") + "_promote";
        await bumpCacheVersion(supabaseAdmin);
      } catch (e) {
        reason = `promote_failed:${(e as Error).message}`;
      }
    } else {
      await supabaseAdmin.from("telegram_ingest").update({
        match_status: "unmatched",
        match_score: match.matchScore,
      }).eq("id", r.id);
    }

    await writeMatchAudit(supabaseAdmin, {
      ingestId: r.id,
      titleId: finalTitleId,
      match,
      settings,
      decision: promoted ? (data.assignTitleId ? "manual" : (match.matchedVia === "alias" ? "alias" : "promoted")) : "rejected",
      reason,
      actor,
      parsedSnapshot: {
        title: r.parsed_title, year: r.parsed_year, category: r.parsed_category,
        season: r.parsed_season, episode: r.parsed_episode,
        quality: r.parsed_quality, resolution: r.parsed_resolution, language: r.parsed_language,
      },
    });

    return { ok: true, promoted, fileId, match, reason };
  });

// Re-run the matcher across all nearby telegram_ingest rows for a single title
// and (re)promote any that clear the threshold. Use this when episodes show up
// in Title Debug but not on the live page — it forces a one-off resync without
// touching unrelated titles or hitting the Telegram API.
export const resyncTitleFiles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { titleId: string }) => z.object({ titleId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runMatcher, loadMatchingSettings, autoPromoteToMediaFile, bestTitleScore, revalidatePromotedForTitle } =
      await import("@/lib/telegram-ingest.server");
    const { bumpCacheVersion } = await import("@/lib/indexes.server");

    const { data: title } = await supabaseAdmin
      .from("master_titles").select("*").eq("id", data.titleId).maybeSingle();
    if (!title) throw new Error("Title not found");

    const settings = await loadMatchingSettings(supabaseAdmin);

    // Re-validate already-promoted files: demote any that no longer meet
    // the threshold so stale matches stop showing on the title.
    const revalidation = await revalidatePromotedForTitle(supabaseAdmin, title, settings, {
      actor: `admin:${context.claims?.email ?? context.userId}`,
    });


    const head = (title.title || "").split(/\s+/).filter((w: string) => w.length >= 3)[0] ?? title.title?.[0] ?? "";

    const { data: nearby } = await supabaseAdmin
      .from("telegram_ingest")
      .select("*")
      .ilike("parsed_title", `%${head}%`)
      .is("promoted_media_file_id", null)
      .limit(200);

    let promoted = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const r of nearby ?? []) {
      const { score } = bestTitleScore(r.parsed_title ?? "", title.title, settings);
      const yearOk = !r.parsed_year || !title.release_year ||
        Math.abs(r.parsed_year - title.release_year) <= settings.year_window;
      const categoryOk = !r.parsed_category || !title.category || r.parsed_category === title.category;
      let adjusted = score;
      if (!yearOk) adjusted *= 0.6;
      if (settings.require_category_match && !categoryOk) adjusted = 0;
      else if (!categoryOk) adjusted *= 0.85;
      if (adjusted < settings.threshold || !r.telegram_file_id) { skipped++; continue; }
      try {
        await autoPromoteToMediaFile(supabaseAdmin, {
          ingestId: r.id,
          titleId: title.id,
          channelRowId: r.channel_id,
          telegramFileId: r.telegram_file_id,
          telegramMessageId: r.telegram_message_id,
          fileName: r.file_name ?? r.parsed_title ?? "file",
          caption: r.caption,
          mimeType: r.mime_type,
          fileSize: r.file_size,
          durationSeconds: r.duration_seconds,
          quality: r.parsed_quality,
          resolution: r.parsed_resolution,
          language: r.parsed_language,
          season: r.parsed_season,
          episode: r.parsed_episode,
        });
        promoted++;
      } catch (e) { errors.push((e as Error).message); }
    }
    if (promoted > 0 || revalidation.demoted > 0) await bumpCacheVersion(supabaseAdmin);
    // Silence unused matcher import; keep symmetry with forceRematchAndPublish
    void runMatcher;
    return {
      ok: true,
      scanned: nearby?.length ?? 0,
      promoted,
      skipped,
      demoted: revalidation.demoted,
      revalidated: revalidation.revalidated,
      kept: revalidation.kept,
      errors: errors.slice(0, 5),
    };
  });


// Per-title diagnostic — explains why a title's master record might have no
// files, and lists nearby ingest rows with their scores against this title.
export const getTitleDebug = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { slug: string }) => z.object({ slug: z.string().min(1) }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runMatcher, loadMatchingSettings, bestTitleScore } = await import("@/lib/telegram-ingest.server");

    const { data: title, error: e1 } = await supabaseAdmin
      .from("master_titles")
      .select("*")
      .eq("slug", data.slug)
      .maybeSingle();
    if (e1) throw e1;
    if (!title) throw new Error("Title not found");

    const settings = await loadMatchingSettings(supabaseAdmin);

    // Files currently linked
    const { data: files } = await supabaseAdmin
      .from("media_files")
      .select("id, file_name, episode_id, quality, resolution, language, is_active, created_at, episodes(season_id, episode_number, seasons(season_number))")
      .eq("title_id", title.id);

    // For each linked media_file, find the ingest row that points at it so
    // we can look up the most recent match_audit_log entry — answers
    // "why is this file still here / why didn't it re-match?".
    const fileIds = (files ?? []).map((f: any) => f.id);
    const filesAudit: Record<string, { decision: string; reason: string; attemptAt: string; score: number | null; threshold: number | null; ingestId: string | null }> = {};
    if (fileIds.length > 0) {
      const { data: ingestRows } = await supabaseAdmin
        .from("telegram_ingest")
        .select("id, promoted_media_file_id")
        .in("promoted_media_file_id", fileIds);
      const ingestIds = (ingestRows ?? []).map((r: any) => r.id);
      const ingestToFile = new Map((ingestRows ?? []).map((r: any) => [r.id, r.promoted_media_file_id]));
      if (ingestIds.length > 0) {
        const { data: audits } = await supabaseAdmin
          .from("match_audit_log")
          .select("telegram_ingest_id, decision, reason, attempt_at, scores, threshold")
          .in("telegram_ingest_id", ingestIds)
          .order("attempt_at", { ascending: false });
        for (const a of audits ?? []) {
          const fid = ingestToFile.get(a.telegram_ingest_id);
          if (!fid || filesAudit[fid]) continue;
          filesAudit[fid] = {
            decision: a.decision,
            reason: a.reason ?? "",
            attemptAt: a.attempt_at,
            score: (a.scores as any)?.total ?? null,
            threshold: a.threshold,
            ingestId: a.telegram_ingest_id,
          };
        }
      }
      // Files without any audit row: mark explicitly so UI can say
      // "no audit yet — visible only from cache / version pin".
      for (const f of files ?? []) {
        if (!filesAudit[f.id]) {
          filesAudit[f.id] = {
            decision: "unknown",
            reason: f.is_active
              ? "no audit row — likely served from cached index until next revalidation"
              : "inactive (soft-deleted) — hidden from website",
            attemptAt: f.created_at,
            score: null,
            threshold: null,
            ingestId: null,
          };
        }
      }
    }

    // Aliases for this title
    const { data: aliases } = await supabaseAdmin
      .from("title_aliases")
      .select("id, alias, normalized_alias, created_at")
      .eq("title_id", title.id);


    // Nearby ingest rows: take a head word and search
    const head = (title.title || "").split(/\s+/).filter((w: string) => w.length >= 3)[0] ?? title.title?.[0] ?? "";
    const { data: nearby } = await supabaseAdmin
      .from("telegram_ingest")
      .select("id, parsed_title, parsed_year, parsed_category, parsed_season, parsed_episode, parsed_quality, parsed_resolution, match_status, matched_title_id, promoted_media_file_id, file_name, caption, created_at")
      .ilike("parsed_title", `%${head}%`)
      .order("created_at", { ascending: false })
      .limit(50);

    const scored = (nearby ?? []).map((row: any) => {
      const { score, parts } = bestTitleScore(row.parsed_title ?? "", title.title, settings);
      const yearOk = !row.parsed_year || !title.release_year || Math.abs(row.parsed_year - title.release_year) <= settings.year_window;
      const categoryOk = !row.parsed_category || !title.category || row.parsed_category === title.category;
      let adjusted = score;
      if (!yearOk) adjusted *= 0.6;
      if (settings.require_category_match && !categoryOk) adjusted = 0;
      else if (!categoryOk) adjusted *= 0.85;
      const reasons: string[] = [];
      const reasonCodes: { code: string; detail: string }[] = [];
      if (!row.parsed_title) {
        reasonCodes.push({ code: "PARSE_FAIL_EMPTY_TITLE", detail: "Telegram caption produced no parsable title." });
        reasons.push("parse_fail: empty title");
      }
      if (adjusted < settings.threshold) {
        reasonCodes.push({ code: "SCORE_BELOW_THRESHOLD", detail: `score ${adjusted.toFixed(2)} < threshold ${settings.threshold}` });
        reasons.push(`score ${adjusted.toFixed(2)} < threshold ${settings.threshold}`);
      }
      if (!yearOk) {
        reasonCodes.push({ code: "YEAR_MISMATCH", detail: `parsed=${row.parsed_year} vs title=${title.release_year} (±${settings.year_window})` });
        reasons.push(`year ${row.parsed_year} vs ${title.release_year}`);
      }
      if (!categoryOk) {
        reasonCodes.push({ code: settings.require_category_match ? "CATEGORY_MISMATCH_HARD" : "CATEGORY_MISMATCH_SOFT", detail: `parsed=${row.parsed_category} vs title=${title.category}` });
        reasons.push(`category ${row.parsed_category} vs ${title.category}`);
      }
      if (row.matched_title_id && row.matched_title_id !== title.id) {
        reasonCodes.push({ code: "MATCHED_OTHER_TITLE", detail: `matched_title_id=${row.matched_title_id}` });
        reasons.push(`already matched to another title`);
      }
      if (row.promoted_media_file_id) {
        reasonCodes.push({ code: "ALREADY_PROMOTED", detail: `media_file=${row.promoted_media_file_id}` });
        reasons.push("already promoted");
      }
      if (row.parsed_season == null && title.category !== "movie") {
        reasonCodes.push({ code: "SEASON_PARSE_FAILED", detail: "no S## detected" });
      }
      if (row.parsed_episode == null && title.category !== "movie") {
        reasonCodes.push({ code: "EPISODE_PARSE_FAILED", detail: "no E## detected" });
      }
      return { row, score, parts, adjusted, yearOk, categoryOk, reasons, reasonCodes };
    }).sort((a: any, b: any) => b.adjusted - a.adjusted);

    return {
      title,
      settings,
      files: files ?? [],
      filesAudit,

      aliases: aliases ?? [],
      candidates: scored,
      filtersSummary: {
        status_required: "published",
        is_active_required: true,
        category: title.category,
      },
    };
  });

export const rebuildWebsiteIndexes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { rebuildIndexes } = await import("@/lib/indexes.server");
    return rebuildIndexes(supabaseAdmin);
  });

export const getCacheVersion = createServerFn({ method: "GET" })
  .handler(async () => {
    // Read via a publishable client (anon-readable). Avoid bringing the
    // browser supabase client into the server runtime.
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data } = await sb
      .from("telegram_bot_state")
      .select("cache_version, indexes_rebuilt_at")
      .eq("id", "global")
      .maybeSingle();
    return {
      cacheVersion: data?.cache_version ?? 1,
      indexesRebuiltAt: data?.indexes_rebuilt_at ?? null,
    };
  });
