// Admin-only drilldown for interstitial performance metrics.
// Reads ad_perf_events with optional placement/ad filters + time bucketing,
// and exports CSV for offline analysis.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminAccess } from "@/lib/admin-auth";
import { AD_PLACEMENTS } from "@/lib/ads.functions";

const BUCKETS = ["5m", "1h", "1d"] as const;
type Bucket = (typeof BUCKETS)[number];

const FilterSchema = z.object({
  placements: z.array(z.enum(AD_PLACEMENTS)).max(8).optional(),
  ad_ids: z.array(z.string().uuid()).max(50).optional(),
  from: z.string().datetime(),
  to: z.string().datetime(),
  bucket: z.enum(BUCKETS).default("1h"),
});

export type DrilldownFilter = z.infer<typeof FilterSchema>;

export type DrilldownTimeseriesPoint = {
  ts: string;
  placement: string;
  ttff_p50: number | null;
  ttff_p75: number | null;
  ttff_p95: number | null;
  buffer_p75: number | null;
  dropped_total: number;
  autoplay_blocked: number;
  video_error: number;
  samples: number;
};

export type DrilldownPivotRow = {
  ad_id: string | null;
  ad_name: string | null;
  samples: number;
  ttff_p75: number | null;
  buffer_p75: number | null;
  dropped_total: number;
  autoplay_blocked: number;
  video_error: number;
};

function bucketMs(b: Bucket): number {
  return b === "5m" ? 5 * 60_000 : b === "1h" ? 3600_000 : 86_400_000;
}

function bucketKey(iso: string, b: Bucket): string {
  const t = new Date(iso).getTime();
  const ms = bucketMs(b);
  return new Date(Math.floor(t / ms) * ms).toISOString();
}

function pct(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.floor((p / 100) * s.length));
  return Math.round(s[idx]);
}

type RawEvent = {
  ad_id: string | null;
  placement: string;
  metric: string;
  value: number;
  user_agent: string | null;
  created_at: string;
};

async function fetchEvents(
  supabase: any,
  f: DrilldownFilter,
  limit: number,
): Promise<RawEvent[]> {
  let q = supabase
    .from("ad_perf_events")
    .select("ad_id,placement,metric,value,user_agent,created_at")
    .gte("created_at", f.from)
    .lte("created_at", f.to)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (f.placements?.length) q = q.in("placement", f.placements);
  if (f.ad_ids?.length) q = q.in("ad_id", f.ad_ids);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as RawEvent[];
}

export const getInterstitialDrilldown = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => FilterSchema.parse(d))
  .handler(async ({ data, context }) => {
    await requireAdminAccess(context);
    const events = await fetchEvents(context.supabase, data, 50_000);

    // Pivot by (placement, bucket)
    const series = new Map<
      string,
      {
        ts: string;
        placement: string;
        ttff: number[];
        buffer: number[];
        dropped: number;
        blocked: number;
        errors: number;
        samples: number;
      }
    >();
    // Pivot by ad_id
    const pivot = new Map<
      string,
      {
        ad_id: string | null;
        samples: number;
        ttff: number[];
        buffer: number[];
        dropped: number;
        blocked: number;
        errors: number;
      }
    >();

    for (const ev of events) {
      const ts = bucketKey(ev.created_at, data.bucket);
      const sKey = `${ts}|${ev.placement}`;
      let slot = series.get(sKey);
      if (!slot) {
        slot = {
          ts,
          placement: ev.placement,
          ttff: [],
          buffer: [],
          dropped: 0,
          blocked: 0,
          errors: 0,
          samples: 0,
        };
        series.set(sKey, slot);
      }
      const adKey = ev.ad_id ?? "__null__";
      let prow = pivot.get(adKey);
      if (!prow) {
        prow = { ad_id: ev.ad_id, samples: 0, ttff: [], buffer: [], dropped: 0, blocked: 0, errors: 0 };
        pivot.set(adKey, prow);
      }
      slot.samples += 1;
      prow.samples += 1;
      const v = Number(ev.value) || 0;
      switch (ev.metric) {
        case "ttff_ms":
          slot.ttff.push(v);
          prow.ttff.push(v);
          break;
        case "buffer_ms":
          slot.buffer.push(v);
          prow.buffer.push(v);
          break;
        case "dropped_frames":
          slot.dropped += v;
          prow.dropped += v;
          break;
        case "autoplay_blocked":
          slot.blocked += 1;
          prow.blocked += 1;
          break;
        case "video_error":
          slot.errors += 1;
          prow.errors += 1;
          break;
      }
    }

    const timeseries: DrilldownTimeseriesPoint[] = [...series.values()]
      .map((s) => ({
        ts: s.ts,
        placement: s.placement,
        samples: s.samples,
        ttff_p50: pct(s.ttff, 50),
        ttff_p75: pct(s.ttff, 75),
        ttff_p95: pct(s.ttff, 95),
        buffer_p75: pct(s.buffer, 75),
        dropped_total: s.dropped,
        autoplay_blocked: s.blocked,
        video_error: s.errors,
      }))
      .sort((a, b) => (a.ts < b.ts ? -1 : 1));

    // Resolve ad names
    const adIds = [...pivot.values()].map((p) => p.ad_id).filter((x): x is string => !!x);
    let nameMap = new Map<string, string>();
    if (adIds.length) {
      const { data: ads } = await context.supabase.from("ads").select("id,name").in("id", adIds);
      nameMap = new Map((ads ?? []).map((a: any) => [a.id as string, a.name as string]));
    }

    const pivotRows: DrilldownPivotRow[] = [...pivot.values()]
      .map((p) => ({
        ad_id: p.ad_id,
        ad_name: p.ad_id ? nameMap.get(p.ad_id) ?? null : null,
        samples: p.samples,
        ttff_p75: pct(p.ttff, 75),
        buffer_p75: pct(p.buffer, 75),
        dropped_total: p.dropped,
        autoplay_blocked: p.blocked,
        video_error: p.errors,
      }))
      .sort((a, b) => b.samples - a.samples);

    return {
      generatedAt: new Date().toISOString(),
      total: events.length,
      truncated: events.length >= 50_000,
      timeseries,
      pivot: pivotRows,
    };
  });

function csvEscape(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export const exportInterstitialPerfCSV = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => FilterSchema.parse(d))
  .handler(async ({ data, context }): Promise<{ csv: string; rowCount: number; truncated: boolean }> => {
    await requireAdminAccess(context);
    const events = await fetchEvents(context.supabase, data, 100_000);
    const header = "created_at,placement,ad_id,metric,value,user_agent\n";
    const body = events
      .map((e) =>
        [e.created_at, e.placement, e.ad_id ?? "", e.metric, e.value, e.user_agent ?? ""]
          .map(csvEscape)
          .join(","),
      )
      .join("\n");
    return {
      csv: header + body,
      rowCount: events.length,
      truncated: events.length >= 100_000,
    };
  });

export const listRecentInterstitialAds = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminAccess(context);
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const { data, error } = await context.supabase
      .from("ad_perf_events")
      .select("ad_id")
      .gte("created_at", since)
      .not("ad_id", "is", null)
      .limit(5000);
    if (error) throw error;
    const ids = Array.from(new Set((data ?? []).map((r: any) => r.ad_id as string).filter(Boolean)));
    if (!ids.length) return { ads: [] };
    const { data: ads } = await context.supabase.from("ads").select("id,name,placement").in("id", ids);
    return { ads: (ads ?? []) as { id: string; name: string; placement: string }[] };
  });

// 7/14/30-day baseline comparison for the admin "Baselines & Regressions"
// panel. Returns current 24h window vs rolling baselines and flags
// regressions using the same conservative thresholds as the cron alerter.
const TTFF_HARD_MS = 3500;
const TTFF_RATIO = 1.5;
const ERR_HARD = 0.10;
const ERR_DELTA = 0.05;
const BLOCK_HARD = 0.40;
const BLOCK_DELTA = 0.15;

export type BaselineMetric = {
  current: number | null;
  baseline: number | null;
  delta_pct: number | null;
  regressed: boolean;
};

export type BaselinesResult = {
  generated_at: string;
  placement: string | null;
  metrics: {
    ttff_p75: Record<"7d" | "14d" | "30d", BaselineMetric>;
    video_error_rate: Record<"7d" | "14d" | "30d", BaselineMetric>;
    autoplay_blocked_rate: Record<"7d" | "14d" | "30d", BaselineMetric>;
  };
  regressions: Array<{ metric: string; window: string; current: number; baseline: number | null }>;
};

function evalBaseline(
  metric: "ttff_p75" | "video_error_rate" | "autoplay_blocked_rate",
  current: number | null,
  baseline: number | null,
): BaselineMetric {
  const delta_pct =
    current != null && baseline != null && baseline > 0
      ? Math.round(((current - baseline) / baseline) * 1000) / 10
      : null;
  let regressed = false;
  if (current != null) {
    if (metric === "ttff_p75") {
      regressed = current > TTFF_HARD_MS || (baseline != null && baseline > 0 && current / baseline >= TTFF_RATIO);
    } else if (metric === "video_error_rate") {
      regressed = current > ERR_HARD || (baseline != null && current - baseline >= ERR_DELTA);
    } else {
      regressed = current > BLOCK_HARD || (baseline != null && current - baseline >= BLOCK_DELTA);
    }
  }
  return { current, baseline, delta_pct, regressed };
}

export const getInterstitialBaselines = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ placement: z.enum(AD_PLACEMENTS).nullable().optional() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<BaselinesResult> => {
    await requireAdminAccess(context);
    const sb = context.supabase as unknown as {
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
    };
    const { data: raw, error } = await sb.rpc("interstitial_baselines", {
      _placement: data.placement ?? null,
    });
    if (error) throw error;
    const payload = (raw ?? {}) as {
      generated_at?: string;
      placement?: string | null;
      current?: { ttff_p75: number | null; video_error_rate: number | null; autoplay_blocked_rate: number | null };
      baselines?: Record<
        "7d" | "14d" | "30d",
        { ttff_p75: number | null; video_error_rate: number | null; autoplay_blocked_rate: number | null }
      >;
    };
    const current = payload.current ?? { ttff_p75: null, video_error_rate: null, autoplay_blocked_rate: null };
    const baselines = payload.baselines ?? ({} as NonNullable<typeof payload.baselines>);
    const windows: Array<"7d" | "14d" | "30d"> = ["7d", "14d", "30d"];
    const buildRow = (m: "ttff_p75" | "video_error_rate" | "autoplay_blocked_rate") =>
      Object.fromEntries(
        windows.map((w) => [w, evalBaseline(m, current[m], baselines[w]?.[m] ?? null)]),
      ) as Record<"7d" | "14d" | "30d", BaselineMetric>;
    const metrics = {
      ttff_p75: buildRow("ttff_p75"),
      video_error_rate: buildRow("video_error_rate"),
      autoplay_blocked_rate: buildRow("autoplay_blocked_rate"),
    };
    const regressions: BaselinesResult["regressions"] = [];
    (Object.keys(metrics) as Array<keyof typeof metrics>).forEach((k) => {
      windows.forEach((w) => {
        const r = metrics[k][w];
        if (r.regressed && r.current != null) {
          regressions.push({ metric: k, window: w, current: r.current, baseline: r.baseline });
        }
      });
    });
    return {
      generated_at: payload.generated_at ?? new Date().toISOString(),
      placement: data.placement ?? null,
      metrics,
      regressions,
    };
  });
