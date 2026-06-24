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
      await downloadLogEarlyFailure("needs_verification", { shortener: ver.lastProvider });
      return {
        ok: false as const,
        reason: "needs_verification" as const,
        expiresAt: ver.expiresAt,
      };
    }

    // 1. Resolve the file + its source channel/message + category (used to
    // pick which force-join channels apply).
    let { data: file, error: fileErr } = await supabaseAdmin
      .from("media_files")
      .select("id, file_name, caption, title_id, episode_id, resolution, language, telegram_message_id, telegram_file_id, telegram_file_unique_id, channel_id, telegram_channels(channel_id, name), master_titles(category)")
      .eq("id", data.mediaFileId)
      .maybeSingle();
    if (fileErr) throw fileErr;
    if (!file) {
      await auditFailure("file_not_found");
      await downloadLogEarlyFailure("file_not_found", { shortener: ver.lastProvider });
      return { ok: false as const, reason: "file_not_found" as const };
    }
    const fileCategory: string | null = (file as any).master_titles?.category ?? null;

    // Pre-delivery self-heal. Re-link the media_files row to the newest
    // matching telegram_ingest row BEFORE failing for missing source fields or
    // attempting delivery. Prefer telegram_file_unique_id (same physical file
    // resent under a new message_id), then fall back to channel + identity
    // (title/episode + resolution + language) for resends with a new
    // unique_id (re-encoded uploads).
    {
      const healed = await tryRelinkByIngest(supabaseAdmin, {
        mediaFileId: file.id,
        telegramFileUniqueId: (file as any).telegram_file_unique_id ?? null,
        channelRowId: file.channel_id ?? null,
        episodeId: (file as any).episode_id ?? null,
        titleId: file.title_id,
        resolution: (file as any).resolution ?? null,
        language: (file as any).language ?? null,
        currentMessageId: file.telegram_message_id ?? null,
      });
      if (healed) {
        console.info(
          `[relink] pre_delivery_healed media_file=${file.id} prev_message_id=${file.telegram_message_id ?? null}`,
        );
        const { data: refreshed } = await supabaseAdmin
          .from("media_files")
          .select("id, file_name, title_id, episode_id, resolution, language, telegram_message_id, telegram_file_id, telegram_file_unique_id, channel_id, telegram_channels(channel_id, name), master_titles(category)")
          .eq("id", file.id)
          .maybeSingle();
        if (refreshed) file = refreshed as typeof file;
      }
    }

    const missing: string[] = [];
    if (!file!.telegram_message_id) missing.push("telegram_message_id");
    if (!file!.channel_id) missing.push("channel_id (media_files row not linked to a telegram_channels record)");
    if (file!.channel_id && !(file as any).telegram_channels?.channel_id) {
      missing.push("telegram_channels.channel_id (channel row missing Telegram chat id)");
    }
    if (missing.length) {
      await auditFailure("source_missing", { missing, file_name: (file as any).file_name });
      await downloadLogEarlyFailure("source_missing", { shortener: ver.lastProvider, category: fileCategory, titleId: file!.title_id, fileId: file!.id });
      return {
        ok: false as const,
        reason: "source_missing" as const,
        detail: `Missing source field(s): ${missing.join(", ")}. File id: ${file!.id}.`,
        missing,
        mediaFileId: file!.id,
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
      await downloadLogEarlyFailure("not_linked", { shortener: ver.lastProvider, category: fileCategory, titleId: file.title_id, fileId: file.id });
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
    const makeDeliveryCaption = () => `📥 <b>${file.file_name ?? "Your file"}</b>\nDelivered by StreamVault\n\n${tip}`;
    let deliveryCaption = makeDeliveryCaption();

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
    let { result, history, lastRetryAfterMs } = await deliverWithRetry({
      toChatId: link.telegram_user_id,
      fromChatId: (file as any).telegram_channels.channel_id,
      messageId: file.telegram_message_id!,
      caption: deliveryCaption,
    });

    // 4b. Stale-source recovery. The source message may have been deleted from
    // the channel (Telegram returns "message to copy not found"). Search recent
    // telegram_ingest rows in the same channel for a matching identity
    // (episode_id / title_id + resolution + language), update the media_files
    // row to point at the new message_id, and retry delivery once.
    if (!result.ok && result.kind === "not_found") {
      const recovered = await tryRecoverStaleSource(supabaseAdmin, {
        channelRowId: file.channel_id!,
        telegramFileUniqueId: (file as any).telegram_file_unique_id ?? null,
        episodeId: (file as any).episode_id ?? null,
        titleId: file.title_id,
        resolution: (file as any).resolution ?? null,
        language: (file as any).language ?? null,
        excludeMessageId: file.telegram_message_id ?? null,
      });
      if (recovered) {
        await retireMediaSourceCollisions(supabaseAdmin, file.id, {
          telegramFileId: recovered.telegram_file_id,
          telegramFileUniqueId: recovered.telegram_file_unique_id,
          channelRowId: file.channel_id ?? null,
          telegramMessageId: recovered.telegram_message_id,
        });
        await supabaseAdmin
          .from("media_files")
          .update({
            telegram_message_id: recovered.telegram_message_id,
            telegram_file_id: recovered.telegram_file_id,
            telegram_file_unique_id: recovered.telegram_file_unique_id,
            file_name: recovered.file_name ?? (file as any).file_name,
            caption: recovered.caption ?? null,
            file_size: recovered.file_size ?? null,
            mime_type: recovered.mime_type ?? null,
            duration_seconds: recovered.duration_seconds ?? null,
            quality: recovered.parsed_quality ?? (file as any).quality ?? null,
            resolution: recovered.parsed_resolution ?? (file as any).resolution ?? null,
            language: recovered.parsed_language ?? (file as any).language ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", file.id);
        (file as any).telegram_message_id = recovered.telegram_message_id;
        (file as any).telegram_file_id = recovered.telegram_file_id;
        (file as any).telegram_file_unique_id = recovered.telegram_file_unique_id;
        if (recovered.file_name) (file as any).file_name = recovered.file_name;
        if (recovered.caption !== null) (file as any).caption = recovered.caption;
        if (recovered.parsed_quality) (file as any).quality = recovered.parsed_quality;
        if (recovered.parsed_resolution) (file as any).resolution = recovered.parsed_resolution;
        if (recovered.parsed_language) (file as any).language = recovered.parsed_language;
        deliveryCaption = makeDeliveryCaption();
        const retry = await deliverWithRetry({
          toChatId: link.telegram_user_id,
          fromChatId: (file as any).telegram_channels.channel_id,
          messageId: recovered.telegram_message_id,
          caption: deliveryCaption,
        });
        result = retry.result;
        history = [...history, ...retry.history];
        lastRetryAfterMs = retry.lastRetryAfterMs ?? lastRetryAfterMs;
        console.info(
          `[relink] post_failure_retry media_file=${file.id} candidate_unique_id=${recovered.telegram_file_unique_id ?? null} candidate_message_id=${recovered.telegram_message_id} delivered=${result.ok}${result.ok ? "" : ` kind=${result.kind}`}`,
        );
      } else {
        console.info(
          `[relink] post_failure_no_candidate media_file=${file.id} prev_message_id=${file.telegram_message_id ?? null}`,
        );
      }
    }

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

async function retireMediaSourceCollisions(
  supabase: any,
  keepMediaFileId: string,
  source: {
    telegramFileId: string | null;
    telegramFileUniqueId: string | null;
    channelRowId: string | null;
    telegramMessageId: number | null;
  },
): Promise<void> {
  const ids = new Set<string>();
  const remember = (rows: Array<{ id: string }> | null | undefined) => {
    for (const row of rows ?? []) if (row.id && row.id !== keepMediaFileId) ids.add(row.id);
  };
  if (source.telegramFileUniqueId) {
    const { data } = await supabase
      .from("media_files")
      .select("id")
      .eq("telegram_file_unique_id", source.telegramFileUniqueId)
      .neq("id", keepMediaFileId);
    remember(data);
  }
  if (source.telegramFileId) {
    const { data } = await supabase
      .from("media_files")
      .select("id")
      .eq("telegram_file_id", source.telegramFileId)
      .neq("id", keepMediaFileId);
    remember(data);
  }
  if (source.channelRowId && source.telegramMessageId != null) {
    const { data } = await supabase
      .from("media_files")
      .select("id")
      .eq("channel_id", source.channelRowId)
      .eq("telegram_message_id", source.telegramMessageId)
      .neq("id", keepMediaFileId);
    remember(data);
  }
  if (!ids.size) return;
  for (const id of ids) {
    await supabase
      .from("media_files")
      .update({
        is_active: false,
        deleted_at: new Date().toISOString(),
        deleted_reason: "superseded_by_source_relink",
        telegram_file_id: `duplicate:${id}:${source.telegramFileId ?? "unknown"}`,
        telegram_file_unique_id: null,
        channel_id: null,
        telegram_message_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
  }
}

// Look up the most recent telegram_ingest row in the same channel whose parsed
// identity (episode or title) and resolution/language match the given file.
// Used to swap a stale message_id (deleted from the channel) for a freshly
// uploaded resend without losing the master_titles / episodes linkage.
async function getEpisodeIdentity(
  supabase: any,
  episodeId: string | null,
): Promise<{ season: number | null; episode: number | null } | null> {
  if (!episodeId) return null;
  const { data } = await supabase
    .from("episodes")
    .select("episode_number, seasons(season_number)")
    .eq("id", episodeId)
    .maybeSingle();
  if (!data) return null;
  const rawEpisode = typeof data.episode_number === "number" ? data.episode_number : null;
  return {
    season: typeof data.seasons?.season_number === "number" ? data.seasons.season_number : null,
    episode: rawEpisode != null && rawEpisode > 100 ? rawEpisode % 100 : rawEpisode,
  };
}

// Normalize a title for fuzzy comparison: lower-case, strip diacritics + non
// alphanumerics. Mirrors how parsed_title is stored without doing a DB call.
export function normalizeTitleKey(value: string | null | undefined): string {
  if (!value) return "";
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

// Resolves the canonical title_id set: the title row itself + any title_aliases
// rows that share its title. Used when matched_title_id on a resent ingest row
// happens to point at an alias-side title rather than the canonical one.
async function getTitleIdentitySet(
  supabase: any,
  titleId: string | null,
): Promise<{ titleIds: string[]; normalizedTitles: string[] }> {
  if (!titleId) return { titleIds: [], normalizedTitles: [] };
  const titleIds = new Set<string>([titleId]);
  const titles = new Set<string>();
  try {
    const { data: master } = await supabase
      .from("master_titles")
      .select("id, title, original_title, slug")
      .eq("id", titleId)
      .maybeSingle();
    if (master) {
      for (const v of [master.title, master.original_title, master.slug]) {
        const n = normalizeTitleKey(v);
        if (n) titles.add(n);
      }
    }
    const { data: aliases } = await supabase
      .from("title_aliases")
      .select("title_id, alias, normalized_alias")
      .eq("title_id", titleId);
    for (const a of aliases ?? []) {
      if (a.title_id) titleIds.add(a.title_id);
      const n = a.normalized_alias || normalizeTitleKey(a.alias);
      if (n) titles.add(n);
    }
  } catch (e) {
    console.warn("[downloads] getTitleIdentitySet failed:", (e as Error).message);
  }
  return { titleIds: [...titleIds], normalizedTitles: [...titles] };
}

export async function tryRecoverStaleSource(
  supabase: any,
  args: {
    channelRowId: string;
    telegramFileUniqueId: string | null;
    episodeId: string | null;
    titleId: string | null;
    resolution: string | null;
    language: string | null;
    excludeMessageId: number | null;
  },
): Promise<{
  telegram_message_id: number;
  telegram_file_id: string;
  telegram_file_unique_id: string | null;
  file_name: string | null;
  caption: string | null;
  file_size: number | null;
  mime_type: string | null;
  duration_seconds: number | null;
  parsed_quality: string | null;
  parsed_resolution: string | null;
  parsed_language: string | null;
} | null> {
  try {
    if (args.telegramFileUniqueId) {
      let byUnique = supabase
        .from("telegram_ingest")
        .select(
          "telegram_message_id, telegram_file_id, telegram_file_unique_id, file_name, caption, file_size, mime_type, duration_seconds, parsed_quality, parsed_resolution, parsed_language, matched_title_id",
        )
        .eq("telegram_file_unique_id", args.telegramFileUniqueId)
        .is("deleted_at", null)
        .not("telegram_file_id", "is", null)
        .order("telegram_message_id", { ascending: false })
        .limit(1);
      if (args.excludeMessageId != null) byUnique = byUnique.neq("telegram_message_id", args.excludeMessageId);
      const { data: uniqueRows } = await byUnique;
      const row = uniqueRows?.[0];
      if (row) {
        return {
          telegram_message_id: row.telegram_message_id,
          telegram_file_id: row.telegram_file_id,
          telegram_file_unique_id: row.telegram_file_unique_id ?? null,
          file_name: row.file_name ?? null,
          caption: row.caption ?? null,
          file_size: row.file_size ?? null,
          mime_type: row.mime_type ?? null,
          duration_seconds: row.duration_seconds ?? null,
          parsed_quality: row.parsed_quality ?? null,
          parsed_resolution: row.parsed_resolution ?? null,
          parsed_language: row.parsed_language ?? null,
        };
      }
    }

    if (!args.channelRowId) return null;
    const episodeIdentity = await getEpisodeIdentity(supabase, args.episodeId);
    // We use the channel_id (uuid foreign key) on telegram_ingest. Resolve it
    // by joining via the channel row.
    const { data: ch } = await supabase
      .from("telegram_channels")
      .select("id, channel_id")
      .eq("id", args.channelRowId)
      .maybeSingle();
    if (!ch) return null;

    let q = supabase
      .from("telegram_ingest")
      .select(
        "telegram_message_id, telegram_file_id, telegram_file_unique_id, file_name, caption, file_size, mime_type, duration_seconds, parsed_season, parsed_episode, parsed_quality, parsed_resolution, parsed_language, matched_title_id",
      )
      .eq("telegram_channel_id", ch.channel_id)
      .is("deleted_at", null)
      .not("telegram_file_id", "is", null)
      .order("telegram_message_id", { ascending: false })
      .limit(50);
    if (args.excludeMessageId != null) q = q.neq("telegram_message_id", args.excludeMessageId);
    if (args.titleId) q = q.eq("matched_title_id", args.titleId);
    if (episodeIdentity?.season != null) q = q.eq("parsed_season", episodeIdentity.season);
    if (episodeIdentity?.episode != null) q = q.eq("parsed_episode", episodeIdentity.episode);
    const { data: rows } = await q;
    if (!rows?.length) return null;

    const targetRes = (args.resolution || "").toLowerCase();
    const targetLang = (args.language || "").toLowerCase();
    const exactMatch = rows.find((r: any) => {
      const res = String(r.parsed_resolution || "").toLowerCase();
      const lang = String(r.parsed_language || "").toLowerCase();
      const resOk = !targetRes || !res || res === targetRes;
      const langOk = !targetLang || !lang || lang === targetLang;
      return resOk && langOk;
    });
    const languageMatch = rows.find((r: any) => {
      const lang = String(r.parsed_language || "").toLowerCase();
      return !targetLang || !lang || lang === targetLang;
    });
    const match = exactMatch ?? languageMatch ?? rows[0];
    if (!match) return null;
    return {
      telegram_message_id: match.telegram_message_id,
      telegram_file_id: match.telegram_file_id,
      telegram_file_unique_id: match.telegram_file_unique_id ?? null,
      file_name: match.file_name ?? null,
      caption: match.caption ?? null,
      file_size: match.file_size ?? null,
      mime_type: match.mime_type ?? null,
      duration_seconds: match.duration_seconds ?? null,
      parsed_quality: match.parsed_quality ?? null,
      parsed_resolution: match.parsed_resolution ?? null,
      parsed_language: match.parsed_language ?? null,
    };
  } catch (e) {
    console.warn("[downloads] tryRecoverStaleSource failed:", (e as Error).message);
    return null;
  }
}


// Pre-delivery self-heal. Looks for a newer telegram_ingest row that should
// own this media_files record and rewrites the row's source pointers in place
// (telegram_file_id / unique_id / message_id / channel_id and refreshed
// caption + file metadata). Returns true when the row was updated.
//
// Match priority:
//   1) telegram_file_unique_id — same physical file resent under a new
//      message_id (the canonical Telegram identity).
//   2) Same channel + matched_title_id (+ resolution/language when available)
//      — covers re-encoded resends that get a fresh unique_id.
export async function tryRelinkByIngest(
  supabase: any,
  args: {
    mediaFileId: string;
    telegramFileUniqueId: string | null;
    channelRowId: string | null;
    episodeId: string | null;
    titleId: string | null;
    resolution: string | null;
    language: string | null;
    currentMessageId: number | null;
  },
): Promise<boolean> {
  try {
    type IngestRow = {
      channel_id: string | null;
      telegram_channel_id: number | null;
      telegram_message_id: number;
      telegram_file_id: string;
      telegram_file_unique_id: string | null;
      file_name: string | null;
      caption: string | null;
      file_size: number | null;
      mime_type: string | null;
      duration_seconds: number | null;
      parsed_title: string | null;
      parsed_quality: string | null;
      parsed_season: number | null;
      parsed_episode: number | null;
      parsed_resolution: string | null;
      parsed_language: string | null;
      matched_title_id: string | null;
    };

    const log = (stage: string, info: Record<string, unknown>) => {
      try {
        console.info(
          `[relink] media_file=${args.mediaFileId} stage=${stage} ${JSON.stringify({
            unique_id: args.telegramFileUniqueId,
            channel: args.channelRowId,
            title: args.titleId,
            episode: args.episodeId,
            resolution: args.resolution,
            language: args.language,
            current_message_id: args.currentMessageId,
            ...info,
          })}`,
        );
      } catch {}
    };

    let best: IngestRow | null = null;
    let matchedVia: "unique_id" | "channel_title_episode" | "channel_normalized_title" | null = null;
    const SELECT_COLS =
      "channel_id, telegram_channel_id, telegram_message_id, telegram_file_id, telegram_file_unique_id, file_name, caption, file_size, mime_type, duration_seconds, parsed_title, parsed_quality, parsed_season, parsed_episode, parsed_resolution, parsed_language, matched_title_id";

    if (args.telegramFileUniqueId) {
      const { data } = await supabase
        .from("telegram_ingest")
        .select(SELECT_COLS)
        .eq("telegram_file_unique_id", args.telegramFileUniqueId)
        .is("deleted_at", null)
        .not("telegram_file_id", "is", null)
        .order("telegram_message_id", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) {
        best = data as IngestRow;
        matchedVia = "unique_id";
      }
      log("unique_id_lookup", { hit: !!data });
    }

    if (!best && args.channelRowId) {
      const { data: ch } = await supabase
        .from("telegram_channels")
        .select("id, channel_id")
        .eq("id", args.channelRowId)
        .maybeSingle();
      if (ch?.channel_id) {
        const episodeIdentity = await getEpisodeIdentity(supabase, args.episodeId);
        const titleSet = await getTitleIdentitySet(supabase, args.titleId);

        const targetRes = (args.resolution || "").toLowerCase();
        const targetLang = (args.language || "").toLowerCase();
        const pickBest = (candidates: IngestRow[]) => {
          const exact = candidates.find((r) => {
            const res = String(r.parsed_resolution || "").toLowerCase();
            const lang = String(r.parsed_language || "").toLowerCase();
            const resOk = !targetRes || !res || res === targetRes;
            const langOk = !targetLang || !lang || lang === targetLang;
            return resOk && langOk;
          });
          const lang = candidates.find((r) => {
            const l = String(r.parsed_language || "").toLowerCase();
            return !targetLang || !l || l === targetLang;
          });
          return exact ?? lang ?? candidates[0] ?? null;
        };

        // Tier A: matched_title_id ∈ titleSet (+ episode/season filters)
        let q = supabase
          .from("telegram_ingest")
          .select(SELECT_COLS)
          .eq("telegram_channel_id", ch.channel_id)
          .is("deleted_at", null)
          .not("telegram_file_id", "is", null)
          .order("telegram_message_id", { ascending: false })
          .limit(50);
        if (titleSet.titleIds.length) q = q.in("matched_title_id", titleSet.titleIds);
        if (episodeIdentity?.season != null) q = q.eq("parsed_season", episodeIdentity.season);
        if (episodeIdentity?.episode != null) q = q.eq("parsed_episode", episodeIdentity.episode);
        const { data: rowsA } = await q;
        const candidatesA = (rowsA ?? []) as IngestRow[];
        best = pickBest(candidatesA);
        if (best) matchedVia = "channel_title_episode";
        log("channel_title_lookup", {
          title_id_set: titleSet.titleIds.length,
          season: episodeIdentity?.season ?? null,
          episode: episodeIdentity?.episode ?? null,
          candidates: candidatesA.length,
          hit: !!best,
        });

        // Tier B: no title rows found — fall back to normalized parsed_title
        // match within the same channel (+ episode/season). This rescues resends
        // whose ingest row failed to auto-match a title row.
        if (!best && titleSet.normalizedTitles.length) {
          let q2 = supabase
            .from("telegram_ingest")
            .select(SELECT_COLS)
            .eq("telegram_channel_id", ch.channel_id)
            .is("deleted_at", null)
            .not("telegram_file_id", "is", null)
            .order("telegram_message_id", { ascending: false })
            .limit(100);
          if (episodeIdentity?.season != null) q2 = q2.eq("parsed_season", episodeIdentity.season);
          if (episodeIdentity?.episode != null) q2 = q2.eq("parsed_episode", episodeIdentity.episode);
          const { data: rowsB } = await q2;
          const titleKeySet = new Set(titleSet.normalizedTitles);
          const candidatesB = ((rowsB ?? []) as IngestRow[]).filter((r) => {
            const n = normalizeTitleKey(r.parsed_title);
            if (!n) return false;
            for (const key of titleKeySet) {
              if (n === key || n.includes(key) || key.includes(n)) return true;
            }
            return false;
          });
          best = pickBest(candidatesB);
          if (best) matchedVia = "channel_normalized_title";
          log("channel_normalized_title_lookup", {
            normalized_keys: titleSet.normalizedTitles.length,
            candidates: candidatesB.length,
            hit: !!best,
          });
        }
      } else {
        log("channel_lookup_miss", {});
      }
    }

    if (!best) {
      log("no_match", {});
      return false;
    }
    if (
      best.telegram_message_id === args.currentMessageId &&
      best.channel_id === args.channelRowId
    ) {
      log("already_current", {
        matched_via: matchedVia,
        candidate_unique_id: best.telegram_file_unique_id,
        candidate_message_id: best.telegram_message_id,
      });
      return false;
    }

    const patch: Record<string, unknown> = {
      telegram_message_id: best.telegram_message_id,
      telegram_file_id: best.telegram_file_id,
      telegram_file_unique_id: best.telegram_file_unique_id,
      updated_at: new Date().toISOString(),
    };
    if (best.channel_id) patch.channel_id = best.channel_id;
    if (best.file_name) patch.file_name = best.file_name;
    if (best.caption !== null && best.caption !== undefined) patch.caption = best.caption;
    if (best.file_size != null) patch.file_size = best.file_size;
    if (best.mime_type) patch.mime_type = best.mime_type;
    if (best.duration_seconds != null) patch.duration_seconds = best.duration_seconds;
    if (best.parsed_quality) patch.quality = best.parsed_quality;
    if (best.parsed_resolution) patch.resolution = best.parsed_resolution;
    if (best.parsed_language) patch.language = best.parsed_language;

    await retireMediaSourceCollisions(supabase, args.mediaFileId, {
      telegramFileId: best.telegram_file_id,
      telegramFileUniqueId: best.telegram_file_unique_id,
      channelRowId: best.channel_id,
      telegramMessageId: best.telegram_message_id,
    });

    const { error } = await supabase
      .from("media_files")
      .update(patch)
      .eq("id", args.mediaFileId);
    if (error) {
      console.warn("[downloads] tryRelinkByIngest update failed:", error.message);
      log("update_failed", { matched_via: matchedVia, error: error.message });
      return false;
    }
    log("relinked", {
      matched_via: matchedVia,
      candidate_unique_id: best.telegram_file_unique_id,
      candidate_message_id: best.telegram_message_id,
      candidate_channel: best.channel_id,
    });
    return true;
  } catch (e) {
    console.warn("[downloads] tryRelinkByIngest failed:", (e as Error).message);
    return false;
  }
}
