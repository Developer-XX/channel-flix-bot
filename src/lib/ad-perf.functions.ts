// Anonymous interstitial playback metrics + admin summary.
// Insert path is anon-callable (bounded by the RLS WITH CHECK on
// public.ad_perf_events). Summary path is admin-only.
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminAccess } from "@/lib/admin-auth";
import { AD_PLACEMENTS, INTERSTITIAL_PLACEMENTS, type AdPlacement } from "@/lib/ads.functions";

const AD_PERF_METRICS = [
  "ttff_ms",
  "buffer_ms",
  "dropped_frames",
  "autoplay_blocked",
  "video_error",
] as const;
export type AdPerfMetric = (typeof AD_PERF_METRICS)[number];

function publicClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

export const recordAdPerfEvent = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        ad_id: z.string().uuid().nullable().optional(),
        placement: z.enum(AD_PLACEMENTS),
        metric: z.enum(AD_PERF_METRICS),
        value: z.number().min(0).max(600000),
        user_agent: z.string().max(256).optional(),
        request_id: z.string().uuid().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    try {
      const sb = publicClient();
      await (sb as unknown as { from: (t: string) => { insert: (r: unknown) => Promise<unknown> } })
        .from("ad_perf_events")
        .insert({
          ad_id: data.ad_id ?? null,
          placement: data.placement,
          metric: data.metric,
          value: data.value,
          user_agent: data.user_agent ?? null,
          request_id: data.request_id ?? null,
        });
    } catch {
      /* swallow — telemetry must never break rendering */
    }
    return { ok: true };
  });

// Issue a server-side correlation id for a single interstitial play.
// Anon-callable; the request_id is opaque and auto-expires after 15 minutes
// inside record_interstitial_beacon.
export const issueInterstitialRequest = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        ad_id: z.string().uuid().nullable().optional(),
        placement: z.enum(AD_PLACEMENTS),
        user_agent: z.string().max(256).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<{ request_id: string | null }> => {
    try {
      const sb = publicClient() as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
      };
      const { data: rid } = await sb.rpc("issue_interstitial_request", {
        _ad_id: data.ad_id ?? null,
        _placement: data.placement,
        _user_id: null,
        _session_id: "",
        _ua: data.user_agent ?? "",
      });
      return { request_id: (rid as string | null) ?? null };
    } catch {
      return { request_id: null };
    }
  });

export type AdPerfSummaryRow = {
  placement: AdPlacement;
  samples: number;
  ttff_p50: number | null;
  ttff_p95: number | null;
  buffer_avg_ms: number | null;
  dropped_frames_total: number;
  autoplay_blocked_count: number;
  error_count: number;
};

export type AdPerfSummary = {
  windowHours: number;
  generatedAt: string;
  rows: AdPerfSummaryRow[];
};

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[idx]);
}

export const getAdPerfSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ windowHours: z.number().int().min(1).max(720).default(24) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<AdPerfSummary> => {
    await requireAdminAccess(context);
    const since = new Date(Date.now() - data.windowHours * 3600_000).toISOString();
    const { data: events, error } = await context.supabase
      .from("ad_perf_events")
      .select("placement,metric,value")
      .gte("created_at", since)
      .limit(20000);
    if (error) throw error;

    const byPlacement = new Map<
      AdPlacement,
      { ttff: number[]; buffer: number[]; dropped: number; blocked: number; errors: number; samples: number }
    >();
    for (const p of INTERSTITIAL_PLACEMENTS) {
      byPlacement.set(p, { ttff: [], buffer: [], dropped: 0, blocked: 0, errors: 0, samples: 0 });
    }
    for (const ev of events ?? []) {
      const slot = byPlacement.get(ev.placement as AdPlacement);
      if (!slot) continue;
      slot.samples += 1;
      const value = Number(ev.value) || 0;
      switch (ev.metric) {
        case "ttff_ms":
          slot.ttff.push(value);
          break;
        case "buffer_ms":
          slot.buffer.push(value);
          break;
        case "dropped_frames":
          slot.dropped += value;
          break;
        case "autoplay_blocked":
          slot.blocked += 1;
          break;
        case "video_error":
          slot.errors += 1;
          break;
      }
    }

    const rows: AdPerfSummaryRow[] = INTERSTITIAL_PLACEMENTS.map((placement) => {
      const slot = byPlacement.get(placement)!;
      const ttffSorted = [...slot.ttff].sort((a, b) => a - b);
      const bufferAvg = slot.buffer.length
        ? Math.round(slot.buffer.reduce((a, b) => a + b, 0) / slot.buffer.length)
        : null;
      return {
        placement,
        samples: slot.samples,
        ttff_p50: percentile(ttffSorted, 50),
        ttff_p95: percentile(ttffSorted, 95),
        buffer_avg_ms: bufferAvg,
        dropped_frames_total: slot.dropped,
        autoplay_blocked_count: slot.blocked,
        error_count: slot.errors,
      };
    });

    return {
      windowHours: data.windowHours,
      generatedAt: new Date().toISOString(),
      rows,
    };
  });
