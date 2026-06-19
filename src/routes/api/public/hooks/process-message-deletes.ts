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
            .select("id, chat_id, message_id, attempts")
            .is("done_at", null)
            .lte("delete_at", new Date().toISOString())
            .order("delete_at", { ascending: true })
            .limit(50);
          if (error) throw error;

          processedCount = (rows ?? []).length;
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
