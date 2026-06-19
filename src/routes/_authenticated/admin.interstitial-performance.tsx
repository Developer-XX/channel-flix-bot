import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ArrowLeft, Download, BarChart3 } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  BarChart,
  Bar,
} from "recharts";
import { Button } from "@/components/ui/button";
import { AD_PLACEMENTS, INTERSTITIAL_PLACEMENTS, type AdPlacement } from "@/lib/ads.functions";
import {
  getInterstitialDrilldown,
  exportInterstitialPerfCSV,
  listRecentInterstitialAds,
  getInterstitialBaselines,
  type BaselinesResult,
} from "@/lib/ad-perf-drilldown.functions";

export const Route = createFileRoute("/_authenticated/admin/interstitial-performance")({
  component: Page,
});

type RangeKey = "1h" | "24h" | "7d" | "30d";
const RANGE_HOURS: Record<RangeKey, number> = { "1h": 1, "24h": 24, "7d": 7 * 24, "30d": 30 * 24 };
function bucketFor(hours: number): "5m" | "1h" | "1d" {
  if (hours <= 6) return "5m";
  if (hours <= 7 * 24) return "1h";
  return "1d";
}

function Page() {
  const [range, setRange] = useState<RangeKey>("24h");
  const [placements, setPlacements] = useState<AdPlacement[]>(INTERSTITIAL_PLACEMENTS);
  const [adIds, setAdIds] = useState<string[]>([]);

  const { from, to, bucket } = useMemo(() => {
    const hours = RANGE_HOURS[range];
    const now = Date.now();
    return {
      from: new Date(now - hours * 3600_000).toISOString(),
      to: new Date(now).toISOString(),
      bucket: bucketFor(hours),
    };
  }, [range]);

  const filter = { placements, ad_ids: adIds.length ? adIds : undefined, from, to, bucket } as const;

  const drilldownQ = useQuery({
    queryKey: ["interstitial-drilldown", filter],
    queryFn: () => getInterstitialDrilldown({ data: filter }),
    retry: false,
    refetchInterval: 60_000,
  });

  const baselinesQ = useQuery({
    queryKey: ["interstitial-baselines", placements.length === 1 ? placements[0] : null],
    queryFn: () =>
      getInterstitialBaselines({
        data: { placement: placements.length === 1 ? placements[0] : null },
      }),
    retry: false,
    staleTime: 60_000,
  });

  const adListQ = useQuery({
    queryKey: ["interstitial-ad-list"],
    queryFn: () => listRecentInterstitialAds(),
    retry: false,
    staleTime: 5 * 60_000,
  });

  const csvMut = useMutation({
    mutationFn: () => exportInterstitialPerfCSV({ data: filter }),
    onSuccess: (res) => {
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `interstitial-perf-${range}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
  });

  const data = drilldownQ.data;
  const placementsInData = useMemo(() => {
    const s = new Set(data?.timeseries.map((p) => p.placement) ?? []);
    return [...s];
  }, [data]);

  return (
    <div className="container mx-auto p-4 md:p-6 max-w-7xl">
      <div className="mb-6 flex items-center justify-between gap-2 flex-wrap">
        <div>
          <Link
            to="/admin/analytics"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-1"
          >
            <ArrowLeft className="h-4 w-4" /> Back to analytics
          </Link>
          <h1 className="text-2xl font-display font-bold flex items-center gap-2">
            <BarChart3 className="h-6 w-6" /> Interstitial performance
          </h1>
          <p className="text-sm text-muted-foreground">
            TTFF, buffering, dropped frames, autoplay blocks and video errors. Bucket: {bucket}.
          </p>
        </div>
        <Button
          onClick={() => csvMut.mutate()}
          disabled={csvMut.isPending}
          variant="outline"
          size="sm"
          className="gap-1"
          data-testid="export-csv"
        >
          <Download className="h-4 w-4" />
          {csvMut.isPending ? "Exporting…" : "Export CSV"}
        </Button>
      </div>

      <div className="grid gap-3 mb-6 md:grid-cols-3">
        <div className="rounded-xl border p-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Range</div>
          <div className="flex flex-wrap gap-1">
            {(Object.keys(RANGE_HOURS) as RangeKey[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`text-xs rounded-md px-2.5 py-1 border ${
                  r === range ? "bg-primary text-primary-foreground border-primary" : "bg-card"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <div className="rounded-xl border p-3 md:col-span-1">
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Placements</div>
          <div className="flex flex-wrap gap-1">
            {AD_PLACEMENTS.filter((p) => p.startsWith("interstitial_")).map((p) => {
              const on = placements.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() =>
                    setPlacements((cur) => (on ? cur.filter((x) => x !== p) : [...cur, p]))
                  }
                  className={`text-[11px] font-mono rounded-md px-2 py-1 border ${
                    on ? "bg-primary text-primary-foreground border-primary" : "bg-card"
                  }`}
                >
                  {p.replace("interstitial_", "")}
                </button>
              );
            })}
          </div>
        </div>
        <div className="rounded-xl border p-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Ad ID (optional)</div>
          <select
            multiple
            value={adIds}
            onChange={(e) => setAdIds(Array.from(e.target.selectedOptions).map((o) => o.value))}
            className="w-full h-20 text-xs rounded-md border bg-background p-1"
          >
            {(adListQ.data?.ads ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.placement})
              </option>
            ))}
          </select>
        </div>
      </div>

      {drilldownQ.error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive mb-4">
          {(drilldownQ.error as Error).message}
        </div>
      )}

      {baselinesQ.data && <BaselinesPanel data={baselinesQ.data} />}

      {data && (
        <>
          <Stats data={data} />
          <Chart title="TTFF over time (p75, ms)" data={data.timeseries} placements={placementsInData} dataKey="ttff_p75" />
          <Chart title="Buffer p75 over time (ms)" data={data.timeseries} placements={placementsInData} dataKey="buffer_p75" />
          <FailureBar data={data.timeseries} placements={placementsInData} />
          <PivotTable rows={data.pivot} />
        </>
      )}
    </div>
  );
}

function Stats({ data }: { data: Awaited<ReturnType<typeof getInterstitialDrilldown>> }) {
  const totals = data.timeseries.reduce(
    (acc, p) => {
      acc.samples += p.samples;
      acc.blocked += p.autoplay_blocked;
      acc.errors += p.video_error;
      acc.dropped += p.dropped_total;
      return acc;
    },
    { samples: 0, blocked: 0, errors: 0, dropped: 0 },
  );
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      <Stat label="Total events" value={totals.samples.toLocaleString()} />
      <Stat label="Autoplay blocked" value={totals.blocked.toLocaleString()} />
      <Stat label="Video errors" value={totals.errors.toLocaleString()} />
      <Stat label="Dropped frames" value={totals.dropped.toLocaleString()} />
      {data.truncated && (
        <div className="md:col-span-4 text-xs text-amber-600">
          Result truncated at 50,000 events. Narrow the time range or filter for a complete view.
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-xl font-display font-bold">{value}</div>
    </div>
  );
}

function Chart({
  title,
  data,
  placements,
  dataKey,
}: {
  title: string;
  data: Array<Record<string, unknown>>;
  placements: string[];
  dataKey: string;
}) {
  // Reshape: one row per ts, one column per placement
  const byTs = new Map<string, Record<string, number | string | null>>();
  for (const raw of data) {
    const p = raw as { ts: string; placement: string } & Record<string, number | null>;
    const row = byTs.get(p.ts) ?? { ts: p.ts };
    row[p.placement] = (p[dataKey] as number | null) ?? null;
    byTs.set(p.ts, row);
  }
  const rows = [...byTs.values()].sort((a, b) =>
    String(a.ts) < String(b.ts) ? -1 : 1,
  );
  const colors = ["#3b82f6", "#ef4444", "#22c55e", "#a855f7"];
  return (
    <section className="mb-6">
      <h2 className="text-sm font-semibold mb-2">{title}</h2>
      <div className="rounded-xl border bg-card p-3 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis
              dataKey="ts"
              tickFormatter={(v) => new Date(v as string).toLocaleString([], { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
              fontSize={10}
            />
            <YAxis fontSize={10} />
            <Tooltip labelFormatter={(v) => new Date(v as string).toLocaleString()} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {placements.map((p, i) => (
              <Line key={p} type="monotone" dataKey={p} stroke={colors[i % colors.length]} dot={false} strokeWidth={2} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function FailureBar({
  data,
  placements,
}: {
  data: Array<{ ts: string; placement: string; autoplay_blocked: number; video_error: number }>;
  placements: string[];
}) {
  const byTs = new Map<string, Record<string, number | string>>();
  for (const p of data) {
    const row = byTs.get(p.ts) ?? { ts: p.ts };
    row[`${p.placement}_blocked`] = p.autoplay_blocked;
    row[`${p.placement}_error`] = p.video_error;
    byTs.set(p.ts, row);
  }
  const rows = [...byTs.values()].sort((a, b) => ((a.ts as string) < (b.ts as string) ? -1 : 1));
  return (
    <section className="mb-6">
      <h2 className="text-sm font-semibold mb-2">Autoplay blocks & video errors</h2>
      <div className="rounded-xl border bg-card p-3 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis
              dataKey="ts"
              tickFormatter={(v) => new Date(v as string).toLocaleString([], { month: "numeric", day: "numeric", hour: "2-digit" })}
              fontSize={10}
            />
            <YAxis fontSize={10} />
            <Tooltip labelFormatter={(v) => new Date(v as string).toLocaleString()} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {placements.map((p) => (
              <Bar key={`${p}-b`} dataKey={`${p}_blocked`} stackId={p} fill="#f59e0b" />
            ))}
            {placements.map((p) => (
              <Bar key={`${p}-e`} dataKey={`${p}_error`} stackId={p} fill="#ef4444" />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function PivotTable({
  rows,
}: {
  rows: Array<{
    ad_id: string | null;
    ad_name: string | null;
    samples: number;
    ttff_p75: number | null;
    buffer_p75: number | null;
    dropped_total: number;
    autoplay_blocked: number;
    video_error: number;
  }>;
}) {
  return (
    <section className="mb-6">
      <h2 className="text-sm font-semibold mb-2">By ad</h2>
      <div className="rounded-xl border bg-card overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/40">
            <tr className="text-left">
              <th className="px-3 py-2">Ad</th>
              <th className="px-3 py-2 text-right">Samples</th>
              <th className="px-3 py-2 text-right">TTFF p75 (ms)</th>
              <th className="px-3 py-2 text-right">Buffer p75 (ms)</th>
              <th className="px-3 py-2 text-right">Dropped</th>
              <th className="px-3 py-2 text-right">Blocked</th>
              <th className="px-3 py-2 text-right">Errors</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground text-xs">
                  No data for the selected filters.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.ad_id ?? "null"} className="border-t">
                <td className="px-3 py-2">
                  <div className="font-medium">{r.ad_name ?? <em className="text-muted-foreground">unnamed</em>}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">{r.ad_id ?? "—"}</div>
                </td>
                <td className="px-3 py-2 text-right">{r.samples.toLocaleString()}</td>
                <td className="px-3 py-2 text-right">{r.ttff_p75 ?? "—"}</td>
                <td className="px-3 py-2 text-right">{r.buffer_p75 ?? "—"}</td>
                <td className="px-3 py-2 text-right">{r.dropped_total.toLocaleString()}</td>
                <td className="px-3 py-2 text-right">{r.autoplay_blocked.toLocaleString()}</td>
                <td className="px-3 py-2 text-right">{r.video_error.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BaselinesPanel({ data }: { data: BaselinesResult }) {
  const windows: Array<"7d" | "14d" | "30d"> = ["7d", "14d", "30d"];
  const rows: Array<{
    key: keyof BaselinesResult["metrics"];
    label: string;
    format: (n: number | null) => string;
  }> = [
    { key: "ttff_p75", label: "TTFF p75", format: (n) => (n == null ? "—" : `${Math.round(n)} ms`) },
    { key: "video_error_rate", label: "Video error rate", format: (n) => (n == null ? "—" : `${(n * 100).toFixed(1)}%`) },
    { key: "autoplay_blocked_rate", label: "Autoplay blocked rate", format: (n) => (n == null ? "—" : `${(n * 100).toFixed(1)}%`) },
  ];
  return (
    <section className="mb-6" data-testid="baselines-panel">
      <h2 className="text-sm font-semibold mb-2">Baselines & regressions</h2>
      {data.regressions.length > 0 ? (
        <div
          role="alert"
          data-testid="baselines-regression-banner"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive mb-3"
        >
          <strong className="font-semibold">{data.regressions.length} regression(s) detected.</strong>{" "}
          {data.regressions
            .map((r) => `${r.metric} vs ${r.window}`)
            .join(", ")}
        </div>
      ) : (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-700 dark:text-emerald-400 mb-3">
          No regressions vs 7/14/30-day baselines.
        </div>
      )}
      <div className="rounded-xl border bg-card overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/40">
            <tr className="text-left">
              <th className="px-3 py-2">Metric</th>
              <th className="px-3 py-2 text-right">Current (24h)</th>
              {windows.map((w) => (
                <th key={w} className="px-3 py-2 text-right">
                  vs {w}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const m = data.metrics[r.key];
              const current = m["7d"].current;
              return (
                <tr key={r.key} className="border-t">
                  <td className="px-3 py-2 font-medium">{r.label}</td>
                  <td className="px-3 py-2 text-right font-mono">{r.format(current)}</td>
                  {windows.map((w) => {
                    const cell = m[w];
                    const arrow = cell.delta_pct == null ? "" : cell.delta_pct > 0 ? "▲" : cell.delta_pct < 0 ? "▼" : "·";
                    return (
                      <td
                        key={w}
                        aria-label={cell.regressed ? `${r.label} ${w} regressed` : undefined}
                        className={`px-3 py-2 text-right font-mono ${
                          cell.regressed ? "bg-destructive/15 text-destructive font-semibold" : ""
                        }`}
                      >
                        <div>{r.format(cell.baseline)}</div>
                        {cell.delta_pct != null && (
                          <div className="text-[10px] opacity-70">
                            {arrow} {cell.delta_pct > 0 ? "+" : ""}
                            {cell.delta_pct.toFixed(1)}%
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground mt-1">
        Regression rules: TTFF p75 &gt; 3500 ms or ≥1.5× baseline · error rate &gt; 10% or +5pp · autoplay blocked &gt; 40% or +15pp.
      </p>
    </section>
  );
}
