import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminAccess } from "@/lib/admin-auth";

const CATEGORY = z.enum(["movie", "series", "anime", "cartoon", "kdrama", "documentary"]);

export const listTelegramIngest = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { status?: "pending" | "matched" | "unmatched" | "ignored" | "all" }) => d)
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    let q = context.supabase
      .from("telegram_ingest")
      .select(
        "id, telegram_channel_id, telegram_message_id, file_name, caption, mime_type, file_size, duration_seconds, parsed_title, parsed_year, parsed_season, parsed_episode, parsed_resolution, parsed_quality, parsed_codec, parsed_language, parsed_category, match_status, matched_title_id, match_score, promoted_media_file_id, last_error, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (data.status && data.status !== "all") q = q.eq("match_status", data.status);
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
    const cleaned = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    if (Object.keys(cleaned).length === 0) return { ok: true };
    const { error } = await context.supabase
      .from("telegram_ingest")
      .update(cleaned)
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
      .select("last_update_id, last_run_at, last_run_status, last_run_error")
      .eq("id", "global")
      .maybeSingle();
    if (error) throw error;
    return data;
  });
