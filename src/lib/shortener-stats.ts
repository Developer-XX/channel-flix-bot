// Pure aggregation helpers for shortener health samples.
// Extracted from shortener-admin.functions.ts so it can be unit-tested
// without hitting the database. The shape MUST match what we select from
// `public.shortener_health_log` (column is `checked_at`, not `created_at`).

export type ShortenerHealthSample = {
  provider: string;
  ok: boolean;
  latency_ms: number | null;
  checked_at: string;
  error: string | null;
};

export type ShortenerConfigRow = {
  provider: string;
  enabled?: boolean;
  priority?: number;
  weight?: number;
  notes?: string | null;
  [k: string]: unknown;
};

export type ShortenerProviderStats = {
  total7: number;
  ok7: number;
  total30: number;
  ok30: number;
  avgLatency7: number | null;
  avgLatency30: number | null;
  lastFailure: { at: string; error: string | null } | null;
  lastSample: string | null;
};

const empty = (): ShortenerProviderStats => ({
  total7: 0,
  ok7: 0,
  total30: 0,
  ok30: 0,
  avgLatency7: null,
  avgLatency30: null,
  lastFailure: null,
  lastSample: null,
});

export function aggregateShortenerSamples(
  samples: readonly ShortenerHealthSample[],
  now: Date = new Date(),
): Map<string, ShortenerProviderStats> {
  const since7 = new Date(now.getTime() - 7 * 86400_000).toISOString();
  const stats = new Map<string, ShortenerProviderStats>();
  for (const s of samples) {
    const prev = stats.get(s.provider) ?? empty();
    const created = s.checked_at;
    const lat = typeof s.latency_ms === "number" ? s.latency_ms : null;
    prev.total30++;
    if (s.ok) prev.ok30++;
    if (lat != null) {
      prev.avgLatency30 =
        ((prev.avgLatency30 ?? 0) * (prev.total30 - 1) + lat) / prev.total30;
    }
    if (created >= since7) {
      prev.total7++;
      if (s.ok) prev.ok7++;
      if (lat != null) {
        prev.avgLatency7 =
          ((prev.avgLatency7 ?? 0) * (prev.total7 - 1) + lat) / prev.total7;
      }
    }
    if (!s.ok && !prev.lastFailure) {
      prev.lastFailure = { at: created, error: s.error ?? null };
    }
    if (!prev.lastSample || created > prev.lastSample) prev.lastSample = created;
    stats.set(s.provider, prev);
  }
  return stats;
}

export function buildShortenerReport(
  configs: readonly ShortenerConfigRow[],
  samples: readonly ShortenerHealthSample[],
  now: Date = new Date(),
) {
  const stats = aggregateShortenerSamples(samples, now);
  return configs.map((c) => {
    const st = stats.get(c.provider) ?? empty();
    return {
      ...c,
      successRate7: st.total7 ? Math.round((st.ok7 / st.total7) * 1000) / 10 : null,
      successRate30: st.total30 ? Math.round((st.ok30 / st.total30) * 1000) / 10 : null,
      avgLatencyMs7: st.avgLatency7 ? Math.round(st.avgLatency7) : null,
      avgLatencyMs30: st.avgLatency30 ? Math.round(st.avgLatency30) : null,
      attempts7: st.total7,
      attempts30: st.total30,
      lastFailure: st.lastFailure,
      lastSample: st.lastSample,
    };
  });
}
