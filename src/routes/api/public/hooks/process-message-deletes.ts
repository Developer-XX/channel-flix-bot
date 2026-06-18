// Cron-driven: deletes bot-DM messages whose delete_at has elapsed.
// Auth: apikey header equal to SUPABASE_PUBLISHABLE_KEY (set in pg_cron).
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/process-message-deletes")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = request.headers.get("apikey") ?? "";
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
        if (!expected || apiKey !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { deleteMessage } = await import("@/lib/telegram-api.server");

        const { data: rows, error } = await supabaseAdmin
          .from("scheduled_message_deletes")
          .select("id, chat_id, message_id, attempts")
          .is("done_at", null)
          .lte("delete_at", new Date().toISOString())
          .order("delete_at", { ascending: true })
          .limit(50);
        if (error) {
          return Response.json({ ok: false, error: error.message }, { status: 500 });
        }

        let ok = 0;
        let failed = 0;
        for (const row of rows ?? []) {
          const r = await deleteMessage(row.chat_id, Number(row.message_id));
          if (r.ok) {
            await supabaseAdmin
              .from("scheduled_message_deletes")
              .update({ done_at: new Date().toISOString(), attempts: row.attempts + 1 })
              .eq("id", row.id);
            ok++;
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
            failed++;
          }
        }

        return Response.json({ ok: true, processed: (rows ?? []).length, deleted: ok, failed });
      },
    },
  },
});
