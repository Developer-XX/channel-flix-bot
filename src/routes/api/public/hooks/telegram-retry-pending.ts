// Cron endpoint: reprocess Telegram webhook events whose ingest never
// completed (no processed_at, raw_update persisted, older than 30s). This
// catches updates Telegram delivered while the worker was slow or threw —
// notably caption edits that used to be silently lost when the webhook timed
// out.
//
// Idempotent: ingestTelegramUpdate upserts by (channel_id, message_id) and
// media_files by telegram_file_id, so retrying the same payload is safe.
import { createFileRoute } from "@tanstack/react-router";

const BATCH_LIMIT = 25;
const STALE_AFTER_MS = 30_000;
const MAX_ATTEMPTS = 5;

export const Route = createFileRoute("/api/public/hooks/telegram-retry-pending")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey")
          ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
          ?? "";
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY
          ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY
          ?? "";
        if (!expected || apikey !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString();

        const { data: pending } = await supabaseAdmin
          .from("telegram_webhook_events")
          .select("update_id, raw_update, attempts")
          .is("processed_at", null)
          .not("raw_update", "is", null)
          .lt("received_at", cutoff)
          .lt("attempts", MAX_ATTEMPTS)
          .order("received_at", { ascending: true })
          .limit(BATCH_LIMIT);

        const rows = (pending ?? []) as Array<{ update_id: number; raw_update: any; attempts: number }>;
        if (!rows.length) {
          return Response.json({ ok: true, scanned: 0, processed: 0, errors: 0 });
        }

        const { ingestTelegramUpdate } = await import("@/lib/telegram-ingest.server");
        let processed = 0;
        let errors = 0;
        const errorSample: Array<{ update_id: number; error: string }> = [];

        for (const row of rows) {
          const nextAttempts = (row.attempts ?? 0) + 1;
          try {
            const result = await ingestTelegramUpdate(supabaseAdmin, row.raw_update, "webhook");
            await supabaseAdmin
              .from("telegram_webhook_events")
              .update({
                status: result.status === "duplicate" ? "processed" : result.status,
                processed_at: new Date().toISOString(),
                attempts: nextAttempts,
                last_attempt_at: new Date().toISOString(),
                error: null,
              })
              .eq("update_id", row.update_id);
            processed++;
          } catch (e: any) {
            errors++;
            const msg = (e?.message ?? String(e)).slice(0, 500);
            if (errorSample.length < 5) errorSample.push({ update_id: row.update_id, error: msg });
            await supabaseAdmin
              .from("telegram_webhook_events")
              .update({
                status: "error",
                error: msg,
                attempts: nextAttempts,
                last_attempt_at: new Date().toISOString(),
              })
              .eq("update_id", row.update_id);
          }
        }

        return Response.json({
          ok: true,
          scanned: rows.length,
          processed,
          errors,
          errorSample,
        });
      },
    },
  },
});
