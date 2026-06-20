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
        // cron run picks them up. `?format=csv|json` allows direct download
        // for offline verification of private-chat deletion targets.
        const url = new URL(request.url);
        const dryRun = ["1", "true", "yes"].includes(
          (url.searchParams.get("dryRun") ?? "").toLowerCase(),
        );
        const format = (url.searchParams.get("format") ?? "").toLowerCase();

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { deleteMessage } = await import("@/lib/telegram-api.server");
        const { recordCronRun } = await import("@/lib/audit.server");

        const t0 = Date.now();
        let processedCount = 0;
        let okCount = 0;
        let failedCount = 0;
        let rateLimited429 = 0;
        let retryAfterMsTotal = 0;
        let retryAttemptsTotal = 0;
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
            const targets = (rows ?? []).map((r) => ({
              id: r.id,
              chat_id: r.chat_id,
              message_id: r.message_id,
              delete_at: r.delete_at,
              attempts: r.attempts,
              overdue_seconds: Math.max(
                0,
                Math.floor((Date.now() - new Date(r.delete_at).getTime()) / 1000),
              ),
            }));

            if (format === "csv") {
              const header = ["id", "chat_id", "message_id", "delete_at", "attempts", "overdue_seconds"];
              const lines = [header.join(",")];
              for (const t of targets) {
                lines.push([t.id, t.chat_id, t.message_id, t.delete_at, t.attempts, t.overdue_seconds]
                  .map((c) => {
                    const s = String(c ?? "");
                    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
                  })
                  .join(","));
              }
              return new Response(lines.join("\n"), {
                status: 200,
                headers: {
                  "Content-Type": "text/csv; charset=utf-8",
                  "Content-Disposition": `attachment; filename="message-deletes-dryrun-${Date.now()}.csv"`,
                },
              });
            }

            return Response.json({
              ok: true,
              dryRun: true,
              processed: processedCount,
              targets,
            }, format === "json"
              ? { headers: {
                  "Content-Disposition": `attachment; filename="message-deletes-dryrun-${Date.now()}.json"`,
                } }
              : undefined);
          }

          for (const row of rows ?? []) {
            // Track retry attempts (this is the Nth try for this row).
            retryAttemptsTotal += row.attempts;
            const r = await deleteMessage(row.chat_id, Number(row.message_id));
            if (r.ok) {
              await supabaseAdmin
                .from("scheduled_message_deletes")
                .update({ done_at: new Date().toISOString(), attempts: row.attempts + 1 })
                .eq("id", row.id);
              okCount++;
            } else {
              if (r.status === 429) rateLimited429++;
              if (typeof r.retryAfterMs === "number") retryAfterMsTotal += r.retryAfterMs;
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

        const durationMs = Date.now() - t0;
        const avgMs = processedCount > 0 ? Math.round(durationMs / processedCount) : 0;

        await recordCronRun(
          supabaseAdmin,
          "process-message-deletes",
          runError === null,
          {
            processed: processedCount,
            deleted: okCount,
            failed: failedCount,
            rate_limited_429: rateLimited429,
            retry_after_ms_total: retryAfterMsTotal,
            retry_attempts_total: retryAttemptsTotal,
            duration_ms: durationMs,
            avg_ms_per_message: avgMs,
          },
          runError,
        );

        return Response.json({
          ok: runError === null,
          processed: processedCount,
          deleted: okCount,
          failed: failedCount,
          rate_limited_429: rateLimited429,
          retry_after_ms_total: retryAfterMsTotal,
          retry_attempts_total: retryAttemptsTotal,
          duration_ms: durationMs,
          avg_ms_per_message: avgMs,
          error: runError,
        });
      },
    },
  },
});
