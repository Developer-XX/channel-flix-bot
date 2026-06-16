// Admin-only metrics for the index-rebuild cron job. Reads
// `index_rebuild_runs` rows from the last 24h and returns aggregate
// counts: runs, overlap skips, no_pending skips, errors, and the
// average duration of actual rebuilds (skipped rows excluded).

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function requireAdmin(context: any) {
  const { data: ok } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (!ok) throw new Error("Forbidden: admin only");
}

export const getCronMetrics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: rows, error } = await supabaseAdmin
      .from("index_rebuild_runs")
      .select("started_at, finished_at, skipped, skip_reason, error")
      .gte("started_at", since)
      .order("started_at", { ascending: false });
    if (error) throw error;

    const all = rows ?? [];
    let overlapSkips = 0;
    let noPendingSkips = 0;
    let errors = 0;
    const durations: number[] = [];
    let lastRunAt: string | null = null;
    let lastSuccessAt: string | null = null;

    for (const r of all as any[]) {
      if (!lastRunAt) lastRunAt = r.started_at;
      if (r.skipped) {
        if (r.skip_reason === "overlap") overlapSkips++;
        else if (r.skip_reason === "no_pending") noPendingSkips++;
        continue;
      }
      if (r.error) {
        errors++;
        continue;
      }
      if (r.started_at && r.finished_at) {
        durations.push(new Date(r.finished_at).getTime() - new Date(r.started_at).getTime());
        if (!lastSuccessAt) lastSuccessAt = r.finished_at;
      }
    }
    const avgDurationMs = durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;

    return {
      windowHours: 24,
      total: all.length,
      successful: durations.length,
      overlapSkips,
      noPendingSkips,
      errors,
      avgDurationMs,
      lastRunAt,
      lastSuccessAt,
      // Run frequency = runs per hour over the window
      runsPerHour: Math.round((all.length / 24) * 10) / 10,
    };
  });
