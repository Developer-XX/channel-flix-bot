// Helpers for the download_send_queue table — the durable, idempotent
// record of every Telegram delivery we promised the user. Repeated clicks
// within the same cooldown window collapse to the same row, so we cannot
// double-send. Failures get retried by the process-download-queue cron.

import type { SupabaseClient } from "@supabase/supabase-js";

type SB = SupabaseClient<any, any, any>;

export type QueueRow = {
  idempotency_key: string;
  user_id: string;
  file_id: string;
  title_id: string | null;
  chat_id: number;
  payload: Record<string, unknown>;
  status: "queued" | "sending" | "sent" | "failed" | "deduped";
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  next_attempt_at: string;
  message_id: number | null;
  bot_user_id: number | null;
  reused_from_cooldown: boolean;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
};

// Insert if missing; if a row already exists, return it (and a flag).
export async function claimOrFetchQueueRow(
  supabase: SB,
  args: {
    idempotencyKey: string;
    userId: string;
    fileId: string;
    titleId: string | null;
    chatId: number;
    payload: Record<string, unknown>;
  },
): Promise<{ row: QueueRow; existed: boolean }> {
  // Try insert first.
  const { data: inserted, error: insErr } = await supabase
    .from("download_send_queue")
    .insert({
      idempotency_key: args.idempotencyKey,
      user_id: args.userId,
      file_id: args.fileId,
      title_id: args.titleId,
      chat_id: args.chatId,
      payload: args.payload,
      status: "sending",
    })
    .select("*")
    .maybeSingle();
  if (!insErr && inserted) return { row: inserted as QueueRow, existed: false };
  // Conflict on PK — fetch existing.
  const { data: existing } = await supabase
    .from("download_send_queue")
    .select("*")
    .eq("idempotency_key", args.idempotencyKey)
    .maybeSingle();
  if (!existing) throw insErr ?? new Error("queue claim failed");
  return { row: existing as QueueRow, existed: true };
}

export async function markQueueSent(
  supabase: SB,
  idempotencyKey: string,
  messageId: number,
  botUserId: number | null,
  reused = false,
): Promise<void> {
  await supabase
    .from("download_send_queue")
    .update({
      status: "sent",
      message_id: messageId,
      bot_user_id: botUserId,
      sent_at: new Date().toISOString(),
      reused_from_cooldown: reused,
      last_error: null,
    })
    .eq("idempotency_key", idempotencyKey);
}

export async function markQueueFailureRetry(
  supabase: SB,
  idempotencyKey: string,
  args: {
    attempts: number;
    error: string;
    retryAfterMs?: number | null;
    maxAttempts: number;
  },
): Promise<{ giveUp: boolean; nextAttemptAt: string }> {
  const giveUp = args.attempts >= args.maxAttempts;
  // Exponential backoff capped at 15 min, honoring 429 retry_after if larger.
  const base = Math.min(15 * 60_000, 60_000 * Math.pow(2, Math.max(0, args.attempts - 1)));
  const wait = Math.max(base, args.retryAfterMs ?? 0);
  const nextAt = new Date(Date.now() + wait).toISOString();
  await supabase
    .from("download_send_queue")
    .update({
      status: giveUp ? "failed" : "queued",
      attempts: args.attempts,
      last_error: args.error.slice(0, 500),
      next_attempt_at: nextAt,
    })
    .eq("idempotency_key", idempotencyKey);
  return { giveUp, nextAttemptAt: nextAt };
}
