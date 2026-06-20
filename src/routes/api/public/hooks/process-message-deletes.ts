// Cron-driven: deletes bot-DM messages whose delete_at has elapsed.
// Auth: server-only CRON_SECRET (or service-role) via x-cron-secret /
// Authorization: Bearer header. Publishable/anon keys are NOT accepted.
import { createFileRoute } from "@tanstack/react-router";
import { checkCronAuth } from "@/lib/cron-auth.server";

export const Route = createFileRoute("/api/public/hooks/process-message-deletes")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = checkCronAuth(request);
        if (!auth.ok) return auth.response;

        // Dry-run: when `?dryRun=1` is set, report which rows WOULD be deleted
        // (with their delete_at timing) without calling Telegram or mutating
        // the queue. Useful for validating targets and timing before the real
        // cron run picks them up.
        const url = new URL(request.url);
        const dryRun = ["1", "true", "yes"].includes(
          (url.searchParams.get("dryRun") ?? "").toLowerCase(),
        );

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { deleteMessage } = await import("@/lib/telegram-api.server");
        const { recordCronRun } = await import("@/lib/audit.server");

        let processedCount = 0;
        let okCount = 0;
        let failedCount = 0;
        let runError: string | null = null;

        try {
          const { data: rows, error } = await supabaseAdmin
            .from("scheduled_message_deletes")
            .select("id, chat_id, message_id, attempts, delete_at")
            .is("done_at", null)
            .lte("delete_at", new Date().toISOString())
            .order("delete_at", { ascending: true })
            .limit(50);
          if (error) throw error;

          processedCount = (rows ?? []).length;

          if (dryRun) {
            return Response.json({
              ok: true,
              dryRun: true,
              processed: processedCount,
              targets: (rows ?? []).map((r) => ({
                id: r.id,
                chat_id: r.chat_id,
                message_id: r.message_id,
                delete_at: r.delete_at,
                attempts: r.attempts,
                overdue_seconds: Math.max(
                  0,
                  Math.floor((Date.now() - new Date(r.delete_at).getTime()) / 1000),
                ),
              })),
            });
          }

          for (const row of rows ?? []) {
            const r = await deleteMessage(row.chat_id, Number(row.message_id));
            if (r.ok) {
              await supabaseAdmin
                .from("scheduled_message_deletes")
                .update({ done_at: new Date().toISOString(), attempts: row.attempts + 1 })
                .eq("id", row.id);
              okCount++;
            } else {
              const giveUp = row.attempts + 1 >= 5;
              await supabaseAdmin
                .from("scheduled_message_deletes")
                .update({
                  attempts: row.attempts + 1,
                  last_error: r.error.slice(0, 300),
                  done_at: giveUp ? new Date().toISOString() : null,
                })
                .eq("id", row.id);
              failedCount++;
            }
          }
        } catch (e) {
          runError = (e as Error).message;
        }

        await recordCronRun(
          supabaseAdmin,
          "process-message-deletes",
          runError === null,
          { processed: processedCount, deleted: okCount, failed: failedCount },
          runError,
        );

        return Response.json({
          ok: runError === null,
          processed: processedCount,
          deleted: okCount,
          failed: failedCount,
          error: runError,
        });
      },
    },
  },
});
