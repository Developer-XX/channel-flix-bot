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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
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

    // Global rate-limit: 10 download requests / minute / user. Returns 429
    // with Retry-After + RateLimit-* headers (RFC 9331 draft).
    const { enforceServerFnRateLimit } = await import("@/lib/rate-limit.server");
    await enforceServerFnRateLimit({
      key: `download:${context.userId}`,
      limit: 10,
      windowSec: 60,
    });
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
    // Persists a row to download_logs for failure paths that bail early
    // (verification, link, file_not_found, source_missing). The success/retry
    // path further down records its own row with the full attempt history.
    const downloadLogEarlyFailure = async (
      reason: string,
      extra: { shortener?: string | null; category?: string | null; titleId?: string | null; fileId?: string | null } = {},
    ) => {
      try {
        await supabaseAdmin.from("download_logs").insert({
          user_id: context.userId,
          file_id: extra.fileId ?? data.mediaFileId,
          title_id: extra.titleId ?? null,
          source: "bot_dm",
          delivery_status: "blocked",
          delivery_error: reason,
          failure_reason: reason,
          verification_status: reason === "needs_verification" ? "pending" : "verified",
          shortener_used: extra.shortener ?? null,
          category: extra.category ?? null,
        });
      } catch (e) {
        console.warn("[download-audit] early-failure log insert failed", (e as Error).message);
      }
    };

    const {
      makeIdempotencyKey,
      getBotUserId,
      deliverWithRetry,
      upsertDeliveryAttempt,
      existingDelivery,
    } = await import("@/lib/delivery.server");
    const {
      claimOrFetchQueueRow,
      markQueueSent,
      markQueueFailureRetry,
    } = await import("@/lib/download-queue.server");
    const { openAdminAlert, maybeNotifyAdminsTelegram, writeAudit } = await import("@/lib/audit.server");
    const { getSettingNumber, getSetting } = await import("@/lib/runtime-settings.server");

    // 0. Verification gate (TTL from SHORTENER_ROTATION_HOURS)
    const ver = await getVerificationState(supabaseAdmin, context.userId);
    if (!ver.verified) {
      await auditFailure("needs_verification", { expiresAt: ver.expiresAt });
      return {
        ok: false as const,
        reason: "needs_verification" as const,
        expiresAt: ver.expiresAt,
      };
    }

    // 1. Resolve the file + its source channel/message + category (used to
    // pick which force-join channels apply).
    const { data: file, error: fileErr } = await supabaseAdmin
      .from("media_files")
      .select("id, file_name, title_id, telegram_message_id, channel_id, telegram_channels(channel_id, name), master_titles(category)")
      .eq("id", data.mediaFileId)
      .maybeSingle();
    if (fileErr) throw fileErr;
    if (!file) {
      await auditFailure("file_not_found");
      return { ok: false as const, reason: "file_not_found" as const };
    }
    const fileCategory: string | null = (file as any).master_titles?.category ?? null;
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

    // 2b. Multi-channel force-join gate. Reads public.force_join_channels (or
    // falls back to the legacy single-channel settings) and applies AND/OR.
    // The bot must be administrator of each configured chat so getChatMember
    // can resolve membership.
    const { evaluateForceJoin } = await import("@/lib/force-join.server");
    const forceJoin = await evaluateForceJoin({
      supabaseAdmin,
      telegramUserId: link.telegram_user_id,
      category: fileCategory,
    });
    if (forceJoin.required && !forceJoin.passed) {
      const channelsPayload = forceJoin.channels.map((c) => ({
        id: c.id,
        title: c.title,
        joinUrl: c.inviteUrl ?? "",
        status: c.status,
      }));
      await auditFailure("must_join_channel", {
        rule: forceJoin.rule,
        channels: forceJoin.channels.map((c) => ({ id: c.id, status: c.status, chatId: c.chatId })),
      });
      // Record the gated attempt into download_logs so it shows up in the
      // delivery audit dashboard (the auditFailure helper only writes to
      // admin_audit_log).
      try {
        await supabaseAdmin.from("download_logs").insert({
          user_id: context.userId,
          file_id: file.id,
          title_id: file.title_id,
          source: "bot_dm",
          delivery_status: "blocked",
          delivery_error: `must_join_channel (${forceJoin.rule})`,
          verification_status: "verified",
          verification_provider: ver.lastProvider,
          shortener_used: ver.lastProvider ?? null,
          category: fileCategory,
          force_join_required: true,
          force_join_status: "not_joined",
          force_join_channels: forceJoin.channels as never,
          failure_reason: "must_join_channel",
        });
      } catch (e) {
        console.warn("[download-audit] gated insert failed", (e as Error).message);
      }
      return {
        ok: false as const,
        reason: "must_join_channel" as const,
        rule: forceJoin.rule,
        channels: channelsPayload,
        // legacy single-channel fields kept for older clients
        channel: forceJoin.channels[0]?.chatId ?? "",
        joinUrl: forceJoin.channels[0]?.inviteUrl ?? "",
        channelTitle: forceJoin.channels[0]?.title ?? "",
      };
    }




    // 3. Cooldown-window keyed idempotency. The key includes a window bucket
    //    derived from DOWNLOAD_RESEND_COOLDOWN_SECONDS. Within the same window
    //    the same (user, file) → same key → we return the prior delivered
    //    message instead of re-sending. After the window expires the bucket
    //    changes → new key → fresh send.
    const cooldownSec = Math.max(1, Math.min(60, await getSettingNumber("DOWNLOAD_RESEND_COOLDOWN_SECONDS", 8)));
    const idemKey = makeIdempotencyKey(context.userId, file.id, cooldownSec);
    const botUserId = await getBotUserId();

    const prior = await existingDelivery(supabaseAdmin, idemKey);
    if (prior?.status === "delivered" && prior.telegramMessageId) {
      // Reuse: bot already sent this within the cooldown window.
      await upsertDeliveryAttempt(supabaseAdmin, {
        userId: context.userId,
        mediaFileId: file.id,
        idempotencyKey: idemKey,
        attemptNo: (prior.attemptNo ?? 0) + 1,
        status: "delivered",
        telegramMessageId: prior.telegramMessageId,
        botUserId,
        history: [{ at: new Date().toISOString(), ok: true, reused: true }],
        reusedFromCooldown: true,
      });
      await markQueueSent(supabaseAdmin, idemKey, prior.telegramMessageId, botUserId, true);
      await writeAudit(supabaseAdmin, {
        action: "download.resend_reused",
        actorUserId: context.userId,
        metadata: { mediaFileId: file.id, messageId: prior.telegramMessageId, cooldownSec },
      });
      return {
        ok: true as const,
        delivered: true,
        messageId: prior.telegramMessageId,
        reused: true as const,
        cooldownSec,
      };
    }

    // Build the delivery caption with the file name + an admin-configurable
    // player tip. The default tip recommends MX Player / VLC, which handle
    // multi-audio MKV/HEVC files the stock Android gallery often can't.
    const defaultTip =
      "▶️ Playback tip: if the video won't play or the audio is missing, open this file in <b>MX Player</b> or <b>VLC</b> — both are free and handle every format (MKV, multi-audio, HEVC). Stock gallery players often skip the audio track.";
    const tipRaw = (await getSetting("DOWNLOAD_CAPTION_TIP")) ?? "";
    const tip = tipRaw.trim() || defaultTip;
    const deliveryCaption = `📥 <b>${file.file_name ?? "Your file"}</b>\nDelivered by StreamVault\n\n${tip}`;

    // 3b. Claim/insert the queue row (PK = idempotency key).
    const queue = await claimOrFetchQueueRow(supabaseAdmin, {
      idempotencyKey: idemKey,
      userId: context.userId,
      fileId: file.id,
      titleId: file.title_id ?? null,
      chatId: link.telegram_user_id,
      payload: {
        fromChatId: (file as any).telegram_channels.channel_id,
        messageId: file.telegram_message_id!,
        caption: deliveryCaption,
      },
    });
    if (queue.existed && queue.row.status === "sent" && queue.row.message_id) {
      // A parallel click already delivered. Return that.
      return {
        ok: true as const,
        delivered: true,
        messageId: queue.row.message_id,
        reused: true as const,
        cooldownSec,
      };
    }
    if (queue.existed && (queue.row.status === "queued" || queue.row.status === "sending")) {
      // Another in-flight request is sending. Don't double-send; the cron
      // or the original caller will finalize.
      return {
        ok: true as const,
        queued: true as const,
        cooldownSec,
        nextAttemptAt: queue.row.next_attempt_at,
      };
    }

    // 4. Deliver with retries (honors 429 retry_after)
    const { result, history, lastRetryAfterMs } = await deliverWithRetry({
      toChatId: link.telegram_user_id,
      fromChatId: (file as any).telegram_channels.channel_id,
      messageId: file.telegram_message_id!,
      caption: deliveryCaption,
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
      lastRetryAfterMs,
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
      shortener_used: ver.lastProvider ?? null,
      category: fileCategory,
      force_join_required: forceJoin.required,
      force_join_status: forceJoin.required ? (forceJoin.passed ? "joined" : "not_joined") : "not_required",
      force_join_channels: (forceJoin.channels.length ? forceJoin.channels : null) as never,
      failure_reason: result.ok ? null : result.kind,
      bot_user_id: botUserId,
      idempotency_key: idemKey,
      attempt_count: history.length,
      attempt_history: history,
    });


    // Bump per-title download counter so admin "Most downloaded" reflects reality.
    if (result.ok && file.title_id) {
      await supabaseAdmin.rpc("increment_title_download", { _title_id: file.title_id });
    }

    // Update queue row.
    if (result.ok) {
      await markQueueSent(supabaseAdmin, idemKey, result.messageId, botUserId);
    } else {
      const retryable = result.kind === "rate_limited" || result.kind === "other";
      const attempts = (queue.row.attempts ?? 0) + history.length;
      if (retryable) {
        const { giveUp } = await markQueueFailureRetry(supabaseAdmin, idemKey, {
          attempts,
          error: result.error,
          retryAfterMs: lastRetryAfterMs,
          maxAttempts: queue.row.max_attempts ?? 5,
        });
        if (giveUp) {
          const alertId = await openAdminAlert(supabaseAdmin, {
            kind: "download_queue_stuck",
            severity: "error",
            subject: `Download delivery exhausted retries`,
            details: { userId: context.userId, fileId: file.id, error: result.error.slice(0, 300) },
          });
          await maybeNotifyAdminsTelegram(supabaseAdmin, {
            alertId,
            kind: "download_queue_stuck",
            text: `⚠️ Download delivery gave up after ${attempts} attempts.\nFile: <code>${file.id}</code>\nError: ${result.error.slice(0, 200)}`,
          });
        }
      } else {
        // Non-retryable: mark failed permanently.
        await markQueueFailureRetry(supabaseAdmin, idemKey, {
          attempts: (queue.row.max_attempts ?? 5),
          error: result.error,
          maxAttempts: queue.row.max_attempts ?? 5,
        });
      }
    }

    // 6. Schedule auto-delete of the delivered message (if enabled).
    let autoDeleteAt: string | null = null;
    if (result.ok) {
      try {
        const value = Math.max(0, await getSettingNumber("DOWNLOAD_AUTO_DELETE_VALUE", 30));
        const unit = ((await getSetting("DOWNLOAD_AUTO_DELETE_UNIT")) ?? "minutes").toLowerCase().trim();
        if (value > 0) {
          const mult = unit === "seconds" ? 1000 : unit === "hours" ? 3600_000 : 60_000;
          const deleteAt = new Date(Date.now() + value * mult).toISOString();
          autoDeleteAt = deleteAt;
          await supabaseAdmin.from("scheduled_message_deletes").insert({
            chat_id: link.telegram_user_id,
            message_id: result.messageId,
            user_id: context.userId,
            media_file_id: file.id,
            delete_at: deleteAt,
          });
        }
      } catch (e) {
        console.warn("[download] schedule delete failed:", (e as Error).message);
      }
      return { ok: true as const, delivered: true, messageId: result.messageId, cooldownSec, autoDeleteAt };
    }
    if (result.kind === "blocked" || result.kind === "not_started") {
      await auditFailure("bot_blocked", { kind: result.kind });
      return { ok: false as const, reason: "bot_blocked" as const };
    }
    if (result.kind === "not_found") {
      await auditFailure("source_missing", { kind: "not_found" });
      return { ok: false as const, reason: "source_missing" as const };
    }
    await auditFailure("delivery_failed", { kind: result.kind, error: result.error.slice(0, 300) });
    return { ok: false as const, reason: "delivery_failed" as const, error: result.error };
  });
