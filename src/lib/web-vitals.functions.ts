/**
 * Web Vitals (RUM) summary fetch for the admin diagnostics UI.
 * Reads from `web_vitals_recent_summary` (last 7 days, aggregated).
 *
 * The view runs with security_invoker and the underlying table's SELECT
 * policy already gates this to admins.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type VitalsRow = {
  route: string;
  metric: "LCP" | "CLS" | "INP" | "FCP" | "TTFB" | "TBT";
  sample_count: number;
  avg_value: number;
  p50_value: number;
  p75_value: number;
  p95_value: number;
  good_count: number;
  needs_improvement_count: number;
  poor_count: number;
  last_seen_at: string;
};

export const listWebVitalsSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { limit?: number } | undefined) => ({
    limit: Math.min(Math.max(d?.limit ?? 200, 1), 1000),
  }))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    // Admin gate — keeps the function safe even if RLS on the view changes.
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { data: rows, error } = await supabase
      .from("web_vitals_recent_summary" as never)
      .select(
        "route, metric, sample_count, avg_value, p50_value, p75_value, p95_value, good_count, needs_improvement_count, poor_count, last_seen_at",
      )
      .order("sample_count", { ascending: false })
      .limit(data.limit);

    if (error) throw new Error(error.message);
    return (rows ?? []) as unknown as VitalsRow[];
  });
