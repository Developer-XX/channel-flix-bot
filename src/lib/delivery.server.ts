// Delivery helpers: idempotency keys, retries, audit writes for Telegram DM.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";

export type DeliveryResult =
  | { ok: true; messageId: number }
  | { ok: false; error: string; kind: "blocked" | "not_started" | "not_found" | "other" };

// Hour-bucket key: same user re-clicking the same file within an hour is
// treated as the same request, but a new hour creates a fresh row.
export function makeIdempotencyKey(userId: string, mediaFileId: string): string {
  const bucket = Math.floor(Date.now() / (60 * 60 * 1000));
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

// Retry copyMessage with exponential backoff. Non-retryable kinds short-circuit.
export async function deliverWithRetry(args: {
  toChatId: number;
  fromChatId: number | string;
  messageId: number;
  caption?: string;
  maxAttempts?: number;
}): Promise<{ result: DeliveryResult; history: Array<{ at: string; ok: boolean; error?: string; kind?: string }> }> {
  const { tryCopyMessage } = await import("@/lib/telegram-api.server");
  const max = args.maxAttempts ?? 3;
  const backoffs = [250, 1000, 3000];
  const history: Array<{ at: string; ok: boolean; error?: string; kind?: string }> = [];
  let last: DeliveryResult | null = null;
  for (let i = 0; i < max; i++) {
    if (i > 0) await sleep(backoffs[Math.min(i - 1, backoffs.length - 1)]);
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
      ...(r.ok ? {} : { error: r.error.slice(0, 200), kind: r.kind }),
    });
    if (r.ok) return { result: r, history };
    if (r.kind === "blocked" || r.kind === "not_started" || r.kind === "not_found") break;
  }
  return { result: last!, history };
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
      updated_at: new Date().toISOString(),
    },
    { onConflict: "idempotency_key" },
  );
}

export async function existingDelivery(
  supabase: SupabaseClient<any, any, any>,
  idempotencyKey: string,
): Promise<{ status: string; telegramMessageId: number | null } | null> {
  const { data } = await supabase
    .from("delivery_attempts")
    .select("status, telegram_message_id")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (!data) return null;
  return { status: data.status, telegramMessageId: data.telegram_message_id };
}
