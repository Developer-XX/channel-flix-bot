// Server functions for the bot-DM file delivery flow and Telegram account
// linking. The /api/public/telegram/webhook route is responsible for
// consuming the link codes generated here.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function randomCode(): string {
  // 6 chars, no ambiguous letters
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export const getMyTelegramLink = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("telegram_user_links")
      .select("telegram_user_id, telegram_username, telegram_first_name, linked_at, link_code, link_code_expires_at")
      .eq("user_id", context.userId)
      .maybeSingle();
    let botUsername: string | null = null;
    try {
      const { getMe } = await import("@/lib/telegram-api.server");
      const me = await getMe();
      botUsername = me.username ?? null;
    } catch {}
    return { link: data ?? null, botUsername };
  });

// Generates (or refreshes) a 6-character code the user pastes into Telegram
// via /start link_<code>. Codes expire in 15 minutes.
export const requestLinkCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Generate a unique-enough code; retry once on the (extremely rare) collision.
    let code = randomCode();
    const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const { error } = await supabaseAdmin
      .from("telegram_user_links")
      .upsert(
        { user_id: context.userId, link_code: code, link_code_expires_at: expires },
        { onConflict: "user_id" },
      );
    if (error) {
      code = randomCode();
      await supabaseAdmin
        .from("telegram_user_links")
        .upsert(
          { user_id: context.userId, link_code: code, link_code_expires_at: expires },
          { onConflict: "user_id" },
        );
    }
    let botUsername: string | null = null;
    try {
      const { getMe } = await import("@/lib/telegram-api.server");
      const me = await getMe();
      botUsername = me.username ?? null;
    } catch {}
    return { code, expiresAt: expires, botUsername };
  });

export const unlinkTelegram = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("telegram_user_links")
      .update({
        telegram_user_id: null,
        telegram_username: null,
        telegram_first_name: null,
        linked_at: null,
      })
      .eq("user_id", context.userId);
    return { ok: true };
  });

// Click "Download" on a file → bot DMs the user with the file via copyMessage.
// Requires telegram_user_links.telegram_user_id to be set (account linked).
// Re-resolve a series file by (title, season, episode) before delivery so
// stale file_ids (after a rematch/repromote) are corrected automatically.
export const resolveEpisodeFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        titleId: z.string().uuid(),
        season: z.number().int().nullable().optional(),
        episode: z.number().int().nullable().optional(),
        expectedFileId: z.string().uuid().optional(),
        correlationId: z.string().max(64).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { validateEpisodeInput, decideEpisodeResolution } = await import(
      "@/lib/episode-resolution"
    );
    const cid = data.correlationId ?? null;
    const validation = validateEpisodeInput({
      titleId: data.titleId,
      season: data.season ?? null,
      episode: data.episode ?? null,
    });
    if (!validation.ok) {
      return { ok: false as const, reason: validation.reason, detail: validation.detail, correlationId: cid };
    }
    let query = supabaseAdmin
      .from("media_files")
      .select(
        "id, file_name, quality, resolution, language, file_size, episode_id, episodes!inner(episode_number, season_id, seasons!inner(season_number, title_id))",
      )
      .eq("is_active", true)
      .eq("title_id", data.titleId)
      .order("created_at", { ascending: false });
    if (data.season != null) {
      query = query.eq("episodes.seasons.season_number", data.season);
    }
    if (data.episode != null) {
      query = query.eq("episodes.episode_number", data.episode);
    }
    const { data: rows, error } = await query.limit(1);
    if (error) throw error;
    const decision = decideEpisodeResolution({ ok: true }, (rows ?? []) as any, data.expectedFileId);
    if (!decision.ok) {
      return { ok: false as const, reason: decision.reason, detail: decision.detail, correlationId: cid };
    }
    const row: any = decision.file;
    return {
      ok: true as const,
      file: {
        id: row.id,
        file_name: row.file_name,
        quality: row.quality,
        resolution: row.resolution,
        language: row.language,
        file_size: row.file_size,
      },
      changed: decision.changed,
      correlationId: cid,
    };
  });

export const requestDownload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ mediaFileId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getVerificationState } = await import("@/lib/verification.server");
    const { getRequestHeader } = await import("@tanstack/react-start/server");
    const auditFailure = async (reason: string, metadata: Record<string, unknown> = {}) => {
      try {
        await supabaseAdmin.from("admin_audit_log").insert({
          actor_user_id: context.userId,
          actor_email: (context.claims as { email?: string } | null)?.email ?? null,
          action: "download.failed",
          status: "failed",
          ip: getRequestHeader("x-forwarded-for") ?? getRequestHeader("cf-connecting-ip") ?? null,
          user_agent: getRequestHeader("user-agent") ?? null,
          metadata: { mediaFileId: data.mediaFileId, reason, ...metadata },
        } as never);
      } catch (e) {
        console.warn("[download-audit] insert failed", (e as Error).message);
      }
    };
    const {
      makeIdempotencyKey,
      getBotUserId,
      deliverWithRetry,
      upsertDeliveryAttempt,
      existingDelivery,
    } = await import("@/lib/delivery.server");

    // 0. Verification gate (24h)
    const ver = await getVerificationState(supabaseAdmin, context.userId);
    if (!ver.verified) {
      await auditFailure("needs_verification", { expiresAt: ver.expiresAt });
      return {
        ok: false as const,
        reason: "needs_verification" as const,
        expiresAt: ver.expiresAt,
      };
    }

    // 1. Resolve the file + its source channel/message
    const { data: file, error: fileErr } = await supabaseAdmin
      .from("media_files")
      .select("id, file_name, title_id, telegram_message_id, channel_id, telegram_channels(channel_id, name)")
      .eq("id", data.mediaFileId)
      .maybeSingle();
    if (fileErr) throw fileErr;
    if (!file) {
      await auditFailure("file_not_found");
      return { ok: false as const, reason: "file_not_found" as const };
    }
    const missing: string[] = [];
    if (!file.telegram_message_id) missing.push("telegram_message_id");
    if (!file.channel_id) missing.push("channel_id (media_files row not linked to a telegram_channels record)");
    if (file.channel_id && !(file as any).telegram_channels?.channel_id) {
      missing.push("telegram_channels.channel_id (channel row missing Telegram chat id)");
    }
    if (missing.length) {
      await auditFailure("source_missing", { missing, file_name: (file as any).file_name });
      return {
        ok: false as const,
        reason: "source_missing" as const,
        detail: `Missing source field(s): ${missing.join(", ")}. File id: ${file.id}.`,
        missing,
        mediaFileId: file.id,
      };
    }

    // 2. Resolve linked Telegram id
    const { data: link } = await supabaseAdmin
      .from("telegram_user_links")
      .select("telegram_user_id, telegram_username")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!link?.telegram_user_id) {
      await auditFailure("not_linked");
      return { ok: false as const, reason: "not_linked" as const };
    }

    // 3. Idempotency check — same user+file inside the same hour bucket
    const idemKey = makeIdempotencyKey(context.userId, file.id);
    const existing = await existingDelivery(supabaseAdmin, idemKey);
    if (existing?.status === "delivered" && existing.telegramMessageId) {
      // Re-send the same message id is undefined; treat as success and let
      // the user know. (We don't re-copy to avoid Telegram dedupe surprises.)
      return {
        ok: true as const,
        delivered: true,
        deduped: true,
        messageId: existing.telegramMessageId,
      };
    }

    const botUserId = await getBotUserId();

    // 4. Deliver with retries
    const { result, history } = await deliverWithRetry({
      toChatId: link.telegram_user_id,
      fromChatId: (file as any).telegram_channels.channel_id,
      messageId: file.telegram_message_id!,
      caption: `📥 ${file.file_name ?? "Your file"}\nDelivered by StreamVault`,
    });

    await upsertDeliveryAttempt(supabaseAdmin, {
      userId: context.userId,
      mediaFileId: file.id,
      idempotencyKey: idemKey,
      attemptNo: history.length,
      status: result.ok ? "delivered" : "failed",
      error: result.ok ? null : result.error.slice(0, 500),
      telegramMessageId: result.ok ? result.messageId : null,
      botUserId,
      history,
    });

    await supabaseAdmin.from("download_logs").insert({
      user_id: context.userId,
      file_id: file.id,
      title_id: file.title_id,
      source: "bot_dm",
      delivery_status: result.ok ? "delivered" : result.kind,
      delivery_error: result.ok ? null : result.error.slice(0, 500),
      delivered_at: result.ok ? new Date().toISOString() : null,
      verification_status: "verified",
      verification_provider: ver.lastProvider,
      bot_user_id: botUserId,
      idempotency_key: idemKey,
      attempt_count: history.length,
      attempt_history: history,
    });

    if (result.ok) return { ok: true as const, delivered: true, messageId: result.messageId };
    if (result.kind === "blocked" || result.kind === "not_started") {
      return { ok: false as const, reason: "bot_blocked" as const };
    }
    if (result.kind === "not_found") {
      return { ok: false as const, reason: "source_missing" as const };
    }
    return { ok: false as const, reason: "delivery_failed" as const, error: result.error };
  });
