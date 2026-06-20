// Cron-driven: deletes bot-DM messages whose delete_at has elapsed.
// Auth: server-only CRON_SECRET (or service-role) via x-cron-secret /
// Authorization: Bearer header. Publishable/anon keys are NOT accepted.
import { createFileRoute } from "@tanstack/react-router";
import { checkCronAuth } from "@/lib/cron-auth.server";

const JOB = "process-message-deletes";
const LOCK_TTL_SEC = 240; // safety net if a run crashes mid-flight

export const Route = createFileRoute("/api/public/hooks/process-message-deletes")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = checkCronAuth(request);
        if (!auth.ok) return auth.response;

        const url = new URL(request.url);
        const dryRun = ["1", "true", "yes"].includes(
          (url.searchParams.get("dryRun") ?? "").toLowerCase(),
        );
        const format = (url.searchParams.get("format") ?? "").toLowerCase();

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { deleteMessage } = await import("@/lib/telegram-api.server");
        const { recordCronRun, openAdminAlert, maybeNotifyAdminsTelegram, resolveAdminAlerts } =
          await import("@/lib/audit.server");

        // Dry-run never mutates and never acquires the lock so it can be invoked
        // concurrently with the real cron run.
        const t0 = Date.now();
        let processedCount = 0;
        let okCount = 0;
        let failedCount = 0;
        let rateLimited429 = 0;
        let retryAfterMsTotal = 0;
        let retryAttemptsTotal = 0;
        let runError: string | null = null;
        let lockAcquired = false;

        try {
          if (!dryRun) {
            const { data: gotLock } = await supabaseAdmin.rpc("try_acquire_cron_lock", {
              _job_name: JOB,
              _ttl_seconds: LOCK_TTL_SEC,
              _holder: "cron",
            });
            if (gotLock !== true) {
              return Response.json({
                ok: true,
                skipped: true,
                reason: "another run is in progress",
              });
            }
            lockAcquired = true;
          }

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
        } finally {
          if (lockAcquired) {
            try { await supabaseAdmin.rpc("release_cron_lock", { _job_name: JOB }); } catch {}
          }
        }

        const durationMs = Date.now() - t0;
        const avgMs = processedCount > 0 ? Math.round(durationMs / processedCount) : 0;

        await recordCronRun(
          supabaseAdmin,
          JOB,
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

        // ----- Threshold alerts -----
        // (1) too many 429s in a single run
        const FLOOD_429_THRESHOLD = 5;
        if (rateLimited429 >= FLOOD_429_THRESHOLD) {
          const alertId = await openAdminAlert(supabaseAdmin, {
            kind: "cron_rate_limit",
            severity: "warn",
            subject: `Telegram 429 flood in ${JOB}`,
            details: { rateLimited429, retryAfterMsTotal, processed: processedCount, durationMs },
            source: JOB,
          });
          await maybeNotifyAdminsTelegram(supabaseAdmin, {
            alertId,
            kind: "cron_rate_limit",
            text: `⚠️ <b>Telegram rate limit</b>\nJob: <code>${JOB}</code>\n429s: <b>${rateLimited429}</b> in ${processedCount} ops · retry-after total ${retryAfterMsTotal}ms`,
          });
        } else {
          await resolveAdminAlerts(supabaseAdmin, "cron_rate_limit", `Telegram 429 flood in ${JOB}`);
        }

        // (2) sustained slow runs (avg > 3000ms/message on a non-trivial batch)
        const SLOW_AVG_MS = 3000;
        if (processedCount >= 5 && avgMs > SLOW_AVG_MS) {
          const alertId = await openAdminAlert(supabaseAdmin, {
            kind: "cron_slow",
            severity: "warn",
            subject: `${JOB} avg duration high`,
            details: { avgMs, processed: processedCount, durationMs },
            source: JOB,
          });
          await maybeNotifyAdminsTelegram(supabaseAdmin, {
            alertId,
            kind: "cron_slow",
            text: `🐢 <b>Cron slow</b>\nJob: <code>${JOB}</code>\nAvg: <b>${avgMs}ms</b>/op across ${processedCount}`,
          });
        } else if (processedCount >= 5 && avgMs <= SLOW_AVG_MS) {
          await resolveAdminAlerts(supabaseAdmin, "cron_slow", `${JOB} avg duration high`);
        }

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
