// Admin-side aggregates for the "How to download" onboarding tutorial.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminAccess } from "@/lib/admin-auth";

export type OnboardingSummary = {
  windowHours: number;
  totals: { opened: number; completed: number; skipped: number };
  completionRate: number;
  recent: Array<{
    created_at: string;
    event: string;
    video_type: string | null;
    user_id: string | null;
    watched_ms: number | null;
  }>;
  daily: Array<{ day: string; opened: number; completed: number; skipped: number }>;
};

export const getOnboardingSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OnboardingSummary> => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const since24 = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: recent, error } = await supabaseAdmin
      .from("onboarding_events")
      .select("created_at, event, video_type, user_id, watched_ms")
      .gte("created_at", since7d)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw error;

    const rows = (recent ?? []) as Array<{
      created_at: string; event: string; video_type: string | null;
      user_id: string | null; watched_ms: number | null;
    }>;

    const in24 = rows.filter((r) => r.created_at >= since24);
    const totals = {
      opened: in24.filter((r) => r.event === "opened").length,
      completed: in24.filter((r) => r.event === "completed").length,
      skipped: in24.filter((r) => r.event === "skipped").length,
    };
    const completionRate = totals.opened > 0 ? totals.completed / totals.opened : 0;

    const byDay = new Map<string, { opened: number; completed: number; skipped: number }>();
    for (const r of rows) {
      const day = r.created_at.slice(0, 10);
      const cur = byDay.get(day) ?? { opened: 0, completed: 0, skipped: 0 };
      if (r.event === "opened") cur.opened++;
      else if (r.event === "completed") cur.completed++;
      else if (r.event === "skipped") cur.skipped++;
      byDay.set(day, cur);
    }
    const daily = Array.from(byDay.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([day, v]) => ({ day, ...v }));

    return {
      windowHours: 24,
      totals,
      completionRate,
      recent: rows.slice(0, 50),
      daily,
    };
  });
