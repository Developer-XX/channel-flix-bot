// Cron-driven: drains the download_send_queue. Picks queued rows whose
// next_attempt_at has elapsed, attempts copyMessage, updates status.
// Auth: apikey header equal to SUPABASE_PUBLISHABLE_KEY (set in pg_cron).
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/process-download-queue")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = request.headers.get("apikey") ?? "";
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
        if (!expected || apiKey !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { deliverWithRetry, getBotUserId } = await import("@/lib/delivery.server");
        const { markQueueSent, markQueueFailureRetry } = await import("@/lib/download-queue.server");
        const { recordCronRun } = await import("@/lib/audit.server");

        let processed = 0;
        let sent = 0;
        let failed = 0;
        let runError: string | null = null;

        try {
          const nowIso = new Date().toISOString();
          const { data: rows, error } = await supabaseAdmin
            .from("download_send_queue")
            .select("*")
            .in("status", ["queued"])
            .lte("next_attempt_at", nowIso)
            .order("next_attempt_at", { ascending: true })
            .limit(25);
          if (error) throw error;

          const botUserId = await getBotUserId();

          for (const row of (rows as any[]) ?? []) {
            processed++;
            // Optimistic lock: mark sending if still queued.
            const { data: locked } = await supabaseAdmin
              .from("download_send_queue")
              .update({ status: "sending" })
              .eq("idempotency_key", row.idempotency_key)
              .eq("status", "queued")
              .select("idempotency_key")
              .maybeSingle();
            if (!locked) continue; // someone else grabbed it

            const payload = row.payload as { fromChatId: number | string; messageId: number; caption?: string };
            const { result, lastRetryAfterMs } = await deliverWithRetry({
              toChatId: row.chat_id,
              fromChatId: payload.fromChatId,
              messageId: payload.messageId,
              caption: payload.caption,
            });
            if (result.ok) {
              await markQueueSent(supabaseAdmin, row.idempotency_key, result.messageId, botUserId);
              await supabaseAdmin.from("delivery_attempts").upsert(
                {
                  user_id: row.user_id,
                  media_file_id: row.file_id,
                  idempotency_key: row.idempotency_key,
                  attempt_no: (row.attempts ?? 0) + 1,
                  status: "delivered",
                  telegram_message_id: result.messageId,
                  bot_user_id: botUserId,
                  history: [{ at: new Date().toISOString(), ok: true, source: "cron" }],
                  updated_at: new Date().toISOString(),
                },
                { onConflict: "idempotency_key" },
              );
              sent++;
            } else {
              await markQueueFailureRetry(supabaseAdmin, row.idempotency_key, {
                attempts: (row.attempts ?? 0) + 1,
                error: result.error,
                retryAfterMs: lastRetryAfterMs,
                maxAttempts: row.max_attempts ?? 5,
              });
              failed++;
            }
          }
        } catch (e) {
          runError = (e as Error).message;
        }

        await recordCronRun(
          (await import("@/integrations/supabase/client.server")).supabaseAdmin,
          "process-download-queue",
          runError === null,
          { processed, sent, failed },
          runError,
        );

        return Response.json({ ok: runError === null, processed, sent, failed, error: runError });
      },
    },
  },
});
