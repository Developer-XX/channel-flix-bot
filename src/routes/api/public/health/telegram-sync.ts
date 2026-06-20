// Public status endpoint for Telegram sync health.
// Returns last successful sync time, last error, queue/backlog size, and a
// terse status string. No PII; safe to expose for uptime checks.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/health/telegram-sync")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const now = Date.now();
          const since24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();

          const [{ data: state }, { count: unmatched }, { data: lastError }, { count: errors24h }] = await Promise.all([
            supabaseAdmin
              .from("telegram_bot_state")
              .select("last_run_at, last_run_status, last_run_error")
              .eq("id", "global")
              .maybeSingle(),
            supabaseAdmin
              .from("telegram_ingest")
              .select("id", { count: "exact", head: true })
              .eq("match_status", "unmatched")
              .is("deleted_at", null),
            supabaseAdmin
              .from("telegram_sync_steps")
              .select("created_at, step, error_code")
              .eq("status", "error")
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle(),
            supabaseAdmin
              .from("telegram_sync_steps")
              .select("id", { count: "exact", head: true })
              .eq("status", "error")
              .gte("created_at", since24h),
          ]);

          const lastSyncMs = state?.last_run_at ? new Date(state.last_run_at).getTime() : null;
          const ageSec = lastSyncMs ? Math.round((now - lastSyncMs) / 1000) : null;
          const status: "ok" | "degraded" | "down" | "unknown" =
            ageSec === null
              ? "unknown"
              : ageSec > 30 * 60
                ? "down"
                : state?.last_run_status === "error" || (errors24h ?? 0) > 5
                  ? "degraded"
                  : "ok";

          const body = {
            status,
            lastRunAt: state?.last_run_at ?? null,
            lastRunStatus: state?.last_run_status ?? null,
            lastRunError: state?.last_run_error ?? null,
            ageSec,
            backlog: { unmatched: unmatched ?? 0 },
            errors24h: errors24h ?? 0,
            lastError: lastError ?? null,
            checkedAt: new Date().toISOString(),
          };

          return new Response(JSON.stringify(body), {
            status: status === "down" ? 503 : 200,
            headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=15" },
          });
        } catch (e: any) {
          return new Response(JSON.stringify({ status: "unknown", error: e?.message ?? "error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
