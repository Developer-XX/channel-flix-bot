// Delivery helpers: cooldown-window keyed idempotency, retries with
// retry-after, audit writes for Telegram DM delivery.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";

export type DeliveryResult =
  | { ok: true; messageId: number; reused?: boolean }
  | { ok: false; error: string; kind: "blocked" | "not_started" | "not_found" | "rate_limited" | "other"; retryAfterMs?: number };

// Cooldown-window keyed idempotency: within a cooldown window the same
// (user, file) collapses to the same key, so repeated clicks return the
// prior `delivery_attempts` row instead of triggering another sendMessage.
// After the window elapses, a fresh window-bucket → new key → fresh send.
export function makeIdempotencyKey(
  userId: string,
  mediaFileId: string,
  cooldownSec: number,
): string {
  const window = Math.max(1, cooldownSec || 1);
  const bucket = Math.floor(Date.now() / 1000 / window);
  return createHash("sha256")
    .update(`${userId}|${mediaFileId}|${bucket}`)
    .digest("base64url")
    .slice(0, 32);
}

let _cachedBotId: number | null = null;
export async function getBotUserId(): Promise<number | null> {
  if (_cachedBotId) return _cachedBotId;
  try {
    const { getMe } = await import("@/lib/telegram-api.server");
    const me = await getMe();
    _cachedBotId = me?.id ?? null;
    return _cachedBotId;
  } catch {
    return null;
  }
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Retry copyMessage with exponential backoff. Respects Telegram's
// `retry_after` on 429. Non-retryable kinds short-circuit.
export async function deliverWithRetry(args: {
  toChatId: number;
  fromChatId: number | string;
  messageId: number;
  caption?: string;
  maxAttempts?: number;
}): Promise<{
  result: DeliveryResult;
  history: Array<{ at: string; ok: boolean; error?: string; kind?: string; retryAfterMs?: number }>;
  lastRetryAfterMs: number | null;
}> {
  const { tryCopyMessage } = await import("@/lib/telegram-api.server");
  const max = args.maxAttempts ?? 3;
  const backoffs = [250, 1000, 3000];
  const history: Array<{ at: string; ok: boolean; error?: string; kind?: string; retryAfterMs?: number }> = [];
  let last: DeliveryResult | null = null;
  let lastRetryAfterMs: number | null = null;
  for (let i = 0; i < max; i++) {
    if (i > 0) {
      const wait = last && "retryAfterMs" in last && last.retryAfterMs
        ? last.retryAfterMs
        : backoffs[Math.min(i - 1, backoffs.length - 1)];
      await sleep(wait);
    }
    const r = await tryCopyMessage({
      toChatId: args.toChatId,
      fromChatId: args.fromChatId,
      messageId: args.messageId,
      caption: args.caption,
    });
    last = r;
    history.push({
      at: new Date().toISOString(),
      ok: r.ok,
      ...(r.ok ? {} : { error: r.error.slice(0, 200), kind: r.kind, retryAfterMs: r.retryAfterMs }),
    });
    if (!r.ok && r.retryAfterMs) lastRetryAfterMs = r.retryAfterMs;
    if (r.ok) return { result: r, history, lastRetryAfterMs };
    // Non-retryable kinds short-circuit
    if (r.kind === "blocked" || r.kind === "not_started" || r.kind === "not_found") break;
  }
  return { result: last!, history, lastRetryAfterMs };
}

export async function upsertDeliveryAttempt(
  supabase: SupabaseClient<any, any, any>,
  args: {
    userId: string;
    mediaFileId: string;
    idempotencyKey: string;
    attemptNo: number;
    status: "pending" | "delivered" | "failed";
    error?: string | null;
    telegramMessageId?: number | null;
    botUserId?: number | null;
    history: Array<unknown>;
    lastRetryAfterMs?: number | null;
    reusedFromCooldown?: boolean;
  },
): Promise<void> {
  await supabase.from("delivery_attempts").upsert(
    {
      user_id: args.userId,
      media_file_id: args.mediaFileId,
      idempotency_key: args.idempotencyKey,
      attempt_no: args.attemptNo,
      status: args.status,
      error: args.error ?? null,
      telegram_message_id: args.telegramMessageId ?? null,
      bot_user_id: args.botUserId ?? null,
      history: args.history,
      last_retry_after_ms: args.lastRetryAfterMs ?? null,
      reused_from_cooldown: !!args.reusedFromCooldown,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "idempotency_key" },
  );
}

export async function existingDelivery(
  supabase: SupabaseClient<any, any, any>,
  idempotencyKey: string,
): Promise<{ status: string; telegramMessageId: number | null; attemptNo: number } | null> {
  const { data } = await supabase
    .from("delivery_attempts")
    .select("status, telegram_message_id, attempt_no")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (!data) return null;
  return {
    status: data.status,
    telegramMessageId: data.telegram_message_id,
    attemptNo: data.attempt_no ?? 0,
  };
}
