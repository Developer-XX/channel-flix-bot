// Aggregates Support Group popup + Download Preflight engagement events for
// the admin analytics dashboard.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminAccess } from "@/lib/admin-auth";

export type EngagementSummary = {
  windowHours: 24;
  totals: {
    supportPopupImpressions: number;
    supportPopupJoinClicks: number;
    supportPopupDismisses: number;
    preflightImpressions: number;
    preflightVerifyClicks: number;
    preflightJoinClicks: number;
  };
  rates: {
    supportJoinRate: number;   // join / impressions
    preflightVerifyRate: number; // verify / impressions
    preflightJoinRate: number;   // join / impressions
  };
  daily: Array<{
    day: string;
    support_impr: number; support_join: number;
    preflight_impr: number; preflight_verify: number; preflight_join: number;
  }>;
};

const EVENT_KEYS = [
  "support_popup_impression",
  "support_popup_join_click",
  "support_popup_dismiss",
  "preflight_impression",
  "preflight_verify_click",
  "preflight_join_click",
] as const;
type EventKey = typeof EVENT_KEYS[number];

export const getEngagementSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<EngagementSummary> => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since24 = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabaseAdmin
      .from("engagement_events")
      .select("event, created_at")
      .gte("created_at", since7d)
      .order("created_at", { ascending: false })
      .limit(20000);
    if (error) throw error;
    const rows = (data ?? []) as Array<{ event: EventKey; created_at: string }>;

    const count = (e: EventKey, since: string) =>
      rows.reduce((n, r) => n + (r.event === e && r.created_at >= since ? 1 : 0), 0);

    const totals = {
      supportPopupImpressions: count("support_popup_impression", since24),
      supportPopupJoinClicks: count("support_popup_join_click", since24),
      supportPopupDismisses: count("support_popup_dismiss", since24),
      preflightImpressions: count("preflight_impression", since24),
      preflightVerifyClicks: count("preflight_verify_click", since24),
      preflightJoinClicks: count("preflight_join_click", since24),
    };
    const safeRate = (n: number, d: number) => (d > 0 ? n / d : 0);
    const rates = {
      supportJoinRate: safeRate(totals.supportPopupJoinClicks, totals.supportPopupImpressions),
      preflightVerifyRate: safeRate(totals.preflightVerifyClicks, totals.preflightImpressions),
      preflightJoinRate: safeRate(totals.preflightJoinClicks, totals.preflightImpressions),
    };

    const byDay = new Map<string, {
      support_impr: number; support_join: number;
      preflight_impr: number; preflight_verify: number; preflight_join: number;
    }>();
    for (const r of rows) {
      const day = r.created_at.slice(0, 10);
      const cur = byDay.get(day) ?? {
        support_impr: 0, support_join: 0,
        preflight_impr: 0, preflight_verify: 0, preflight_join: 0,
      };
      if (r.event === "support_popup_impression") cur.support_impr++;
      else if (r.event === "support_popup_join_click") cur.support_join++;
      else if (r.event === "preflight_impression") cur.preflight_impr++;
      else if (r.event === "preflight_verify_click") cur.preflight_verify++;
      else if (r.event === "preflight_join_click") cur.preflight_join++;
      byDay.set(day, cur);
    }
    const daily = Array.from(byDay.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([day, v]) => ({ day, ...v }));

    return { windowHours: 24, totals, rates, daily };
  });
