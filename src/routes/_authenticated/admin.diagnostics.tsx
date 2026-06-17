import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, RefreshCw, Activity, ShieldAlert, Plug, Link2, Gauge, Download, Settings as SettingsIcon, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { runAuthDiagnostics, listAccessAudit } from "@/lib/diagnostics.functions";
import { listWebVitalsSummary, type VitalsRow } from "@/lib/web-vitals.functions";
import { runIntegrationsHealth, getShortenerHealth, probeShortener, exportShortenerHealthCsv } from "@/lib/integrations-health.functions";
import { getVerificationDiagnostics } from "@/lib/verification-diagnostics.functions";
import {
  requestDatabaseWipe,
  confirmDatabaseWipe,
  listAdminAuditLog,
} from "@/lib/destructive.functions";
import { listSettingsAuditLog, getIngestionDedupStats, getChannelMatchBreakdown24h } from "@/lib/admin-diagnostics-extra.functions";

export const Route = createFileRoute("/_authenticated/admin/diagnostics")({
  component: DiagnosticsPage,
});


const RLS_CODES: { code: string; meaning: string }[] = [
  { code: "RLS_PERMISSION_DENIED", meaning: "GRANT missing OR every USING policy returned false. Check both." },
  { code: "RLS_ROW_HIDDEN", meaning: "USING clause evaluated false for this row (token role lacks visibility)." },
  { code: "RLS_POLICY_RECURSION", meaning: "Policy referenced its own table — refactor to a SECURITY DEFINER helper." },
  { code: "JWT_EXPIRED", meaning: "Bearer token expired before reaching PostgREST." },
  { code: "JWT_INVALID", meaning: "Token signature/format invalid." },
  { code: "API_KEY_NOT_JWT", meaning: "Server used sb_secret_* on Data API path expecting JWT key." },
];

function DiagnosticsPage() {
  const run = useServerFn(runAuthDiagnostics);
  const audit = useServerFn(listAccessAudit);
  const vitals = useServerFn(listWebVitalsSummary);
  const q = useQuery({ queryKey: ["auth-diagnostics"], queryFn: () => run(), retry: false });
  const auditQ = useQuery({ queryKey: ["access-audit"], queryFn: () => audit({ data: { limit: 50 } }), retry: false });
  const vitalsQ = useQuery({
    queryKey: ["web-vitals-summary"],
    queryFn: () => vitals({ data: { limit: 200 } }),
    retry: false,
    refetchInterval: 60_000,
  });

  return (
    <div className="p-3 sm:p-6 max-w-4xl mx-auto space-y-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-2xl font-bold truncate">Auth & Admin Diagnostics</h1>
          <p className="text-xs text-muted-foreground">Precise reasons why /admin may or may not load.</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => { q.refetch(); auditQ.refetch(); vitalsQ.refetch(); }} disabled={q.isFetching}>
          <RefreshCw className={`h-3.5 w-3.5 sm:mr-1.5 ${q.isFetching ? "animate-spin" : ""}`} />
          <span className="hidden sm:inline">Re-run</span>
        </Button>
      </div>

      <WebVitalsPanel data={vitalsQ.data} loading={vitalsQ.isLoading} error={vitalsQ.error as Error | null} />

      <IntegrationsHealthPanel />

      <ShortenerHealthPanel />

      <IngestionDedupPanel />

      <VerificationRedirectPanel />

      <DestructiveActionsPanel />

      <SettingsAuditPanel />

      <AdminAuditPanel />


      {q.isLoading && <div className="text-sm text-muted-foreground">Running checks…</div>}
      {q.error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <div className="font-medium">Diagnostics failed</div>
          <div className="font-mono text-xs mt-1 break-words">{(q.error as Error).message}</div>
        </div>
      )}

      {q.data && (
        <>
          <div className="rounded-md border border-border p-3 text-xs space-y-0.5">
            <div className="break-all"><span className="text-muted-foreground">User id:</span> <span className="font-mono">{q.data.userId}</span></div>
            <div className="break-all"><span className="text-muted-foreground">Email:</span> {q.data.email ?? "(none)"}</div>
          </div>
          <div className="space-y-2">
            {q.data.checks.map((c) => (
              <div key={c.code} className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 items-start rounded-md border border-border p-3">
                <StatusIcon status={c.status} />
                <div className="min-w-0">
                  <div className="flex flex-wrap gap-2 items-center">
                    <span className="font-mono text-xs font-semibold break-all">{c.code}</span>
                    <span className={`text-[10px] uppercase tracking-wide ${badgeClass(c.status)}`}>{c.status}</span>
                  </div>
                  <div className="text-sm mt-0.5 break-words">{c.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <section className="rounded-md border border-border p-3 space-y-2">
        <h2 className="font-semibold text-sm">RLS / JWT error code reference</h2>
        <ul className="text-xs space-y-1">
          {RLS_CODES.map((r) => (
            <li key={r.code} className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
              <code className="font-mono text-[11px] text-amber-600 dark:text-amber-300 whitespace-nowrap">{r.code}</code>
              <span className="text-muted-foreground">{r.meaning}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-md border border-border p-3 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm">Recent access audit log</h2>
          <span className="text-[10px] text-muted-foreground">{auditQ.data?.length ?? 0} rows</span>
        </div>
        {auditQ.error && (
          <p className="text-xs text-destructive break-words">{(auditQ.error as Error).message}</p>
        )}
        <div className="overflow-x-auto -mx-3 sm:mx-0">
          <table className="w-full text-[11px] min-w-[640px]">
            <thead className="text-muted-foreground">
              <tr className="text-left">
                <th className="p-1.5">Time</th>
                <th className="p-1.5">Event</th>
                <th className="p-1.5">Code</th>
                <th className="p-1.5">Status</th>
                <th className="p-1.5">JWT exp</th>
                <th className="p-1.5">Admin</th>
                <th className="p-1.5">Detail</th>
              </tr>
            </thead>
            <tbody>
              {(auditQ.data ?? []).map((r: any) => (
                <tr key={r.id} className="border-t border-border/50 align-top">
                  <td className="p-1.5 whitespace-nowrap text-muted-foreground">{new Date(r.created_at).toLocaleTimeString()}</td>
                  <td className="p-1.5">{r.event}</td>
                  <td className="p-1.5 font-mono">{r.code}</td>
                  <td className={`p-1.5 ${badgeClass(r.status)}`}>{r.status}</td>
                  <td className="p-1.5 text-muted-foreground">{r.jwt_exp_in ?? "—"}s</td>
                  <td className="p-1.5">{r.has_admin_role === null ? "?" : r.has_admin_role ? "yes" : "no"}</td>
                  <td className="p-1.5 text-muted-foreground break-words max-w-[260px]">{r.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="pt-2"><Link to="/admin" className="text-sm text-primary">← Back to admin</Link></div>
    </div>
  );
}

function StatusIcon({ status }: { status: "ok" | "warn" | "fail" }) {
  if (status === "ok") return <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />;
  if (status === "warn") return <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />;
  return <XCircle className="h-5 w-5 text-red-500 shrink-0" />;
}

function badgeClass(status: "ok" | "warn" | "fail" | string): string {
  if (status === "ok") return "text-emerald-500";
  if (status === "warn") return "text-amber-500";
  return "text-red-500";
}

// ---------------------------------------------------------------------------
// Web Vitals (RUM) panel
// ---------------------------------------------------------------------------

// Google's Core Web Vitals thresholds (mobile field data).
const VITAL_THRESHOLDS: Record<string, { good: number; poor: number; unit: string; label: string }> = {
  LCP:  { good: 2500, poor: 4000, unit: "ms",  label: "Largest Contentful Paint" },
  CLS:  { good: 0.1,  poor: 0.25, unit: "",    label: "Cumulative Layout Shift" },
  INP:  { good: 200,  poor: 500,  unit: "ms",  label: "Interaction to Next Paint" },
  FCP:  { good: 1800, poor: 3000, unit: "ms",  label: "First Contentful Paint" },
  TTFB: { good: 800,  poor: 1800, unit: "ms",  label: "Time to First Byte" },
  TBT:  { good: 200,  poor: 600,  unit: "ms",  label: "Total Blocking Time" },
};

function ratingFor(metric: string, value: number): "good" | "needs-improvement" | "poor" {
  const t = VITAL_THRESHOLDS[metric];
  if (!t) return "needs-improvement";
  if (value <= t.good) return "good";
  if (value <= t.poor) return "needs-improvement";
  return "poor";
}

function ratingClass(r: "good" | "needs-improvement" | "poor"): string {
  if (r === "good") return "text-emerald-500";
  if (r === "needs-improvement") return "text-amber-500";
  return "text-red-500";
}

function fmtMetric(metric: string, v: number | null | undefined): string {
  if (v == null) return "—";
  const t = VITAL_THRESHOLDS[metric];
  if (!t) return String(v);
  if (t.unit === "ms") return `${Math.round(Number(v))} ms`;
  return Number(v).toFixed(3);
}

function WebVitalsPanel({
  data,
  loading,
  error,
}: {
  data: VitalsRow[] | undefined;
  loading: boolean;
  error: Error | null;
}) {
  // Aggregate per-metric across all routes (sum samples, weighted p75).
  const perMetric = new Map<string, { samples: number; p75: number; p95: number }>();
  for (const r of data ?? []) {
    const prev = perMetric.get(r.metric) ?? { samples: 0, p75: 0, p95: 0 };
    const total = prev.samples + Number(r.sample_count);
    perMetric.set(r.metric, {
      samples: total,
      p75: total ? (prev.p75 * prev.samples + Number(r.p75_value) * Number(r.sample_count)) / total : 0,
      p95: total ? (prev.p95 * prev.samples + Number(r.p95_value) * Number(r.sample_count)) / total : 0,
    });
  }

  return (
    <section className="rounded-md border border-border p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Activity className="h-4 w-4 text-primary" />
        <h2 className="font-semibold text-sm">Real-User Web Vitals — last 7 days</h2>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {data?.length ?? 0} route×metric rows
        </span>
      </div>

      {loading && <p className="text-xs text-muted-foreground">Loading RUM data…</p>}
      {error && <p className="text-xs text-destructive break-words">{error.message}</p>}

      {!loading && !error && perMetric.size === 0 && (
        <p className="text-xs text-muted-foreground">
          No RUM samples yet. Visit a few public pages from a non-headless browser to populate this.
        </p>
      )}

      {perMetric.size > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {Object.keys(VITAL_THRESHOLDS).map((m) => {
            const agg = perMetric.get(m);
            if (!agg || !agg.samples) return null;
            const r = ratingFor(m, agg.p75);
            return (
              <div key={m} className="rounded-md border border-border/60 p-2.5">
                <div className="flex items-center justify-between text-[10px] text-muted-foreground uppercase tracking-wider">
                  <span>{m}</span>
                  <span>{agg.samples.toLocaleString()} obs</span>
                </div>
                <div className={`mt-1 font-mono text-base font-semibold ${ratingClass(r)}`}>
                  {fmtMetric(m, agg.p75)}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  p75 · p95 {fmtMetric(m, agg.p95)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {data && data.length > 0 && (
        <div className="overflow-x-auto -mx-3 sm:mx-0">
          <table className="w-full text-[11px] min-w-[640px]">
            <thead className="text-muted-foreground">
              <tr className="text-left">
                <th className="p-1.5">Route</th>
                <th className="p-1.5">Metric</th>
                <th className="p-1.5">Samples</th>
                <th className="p-1.5">p75</th>
                <th className="p-1.5">p95</th>
                <th className="p-1.5">Good</th>
                <th className="p-1.5">NI</th>
                <th className="p-1.5">Poor</th>
              </tr>
            </thead>
            <tbody>
              {data
                .slice()
                .sort((a, b) => Number(b.sample_count) - Number(a.sample_count))
                .slice(0, 50)
                .map((r) => {
                  const rating = ratingFor(r.metric, Number(r.p75_value));
                  return (
                    <tr key={`${r.route}-${r.metric}`} className="border-t border-border/50">
                      <td className="p-1.5 font-mono text-muted-foreground break-all max-w-[220px]">{r.route}</td>
                      <td className="p-1.5 font-mono">{r.metric}</td>
                      <td className="p-1.5">{Number(r.sample_count).toLocaleString()}</td>
                      <td className={`p-1.5 ${ratingClass(rating)}`}>{fmtMetric(r.metric, Number(r.p75_value))}</td>
                      <td className="p-1.5 text-muted-foreground">{fmtMetric(r.metric, Number(r.p95_value))}</td>
                      <td className="p-1.5 text-emerald-500">{r.good_count}</td>
                      <td className="p-1.5 text-amber-500">{r.needs_improvement_count}</td>
                      <td className="p-1.5 text-red-500">{r.poor_count}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// External integrations health (Telegram, TMDB, link shorteners)
// ---------------------------------------------------------------------------

function IntegrationsHealthPanel() {
  const run = useServerFn(runIntegrationsHealth);
  const q = useQuery({
    queryKey: ["integrations-health"],
    queryFn: () => run(),
    retry: false,
    refetchOnWindowFocus: false,
  });

  return (
    <section className="rounded-md border border-border p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Plug className="h-4 w-4 text-primary" />
        <h2 className="font-semibold text-sm">External integrations</h2>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          onClick={() => q.refetch()}
          disabled={q.isFetching}
        >
          <RefreshCw className={`h-3.5 w-3.5 sm:mr-1.5 ${q.isFetching ? "animate-spin" : ""}`} />
          <span className="hidden sm:inline">Test</span>
        </Button>
      </div>
      {q.isLoading && <p className="text-xs text-muted-foreground">Pinging providers…</p>}
      {q.error && (
        <p className="text-xs text-destructive break-words">{(q.error as Error).message}</p>
      )}
      {q.data && (
        <div className="grid gap-2 sm:grid-cols-2">
          {q.data.checks.map((c) => (
            <div
              key={c.name}
              className="rounded-md border border-border/60 p-2.5 grid grid-cols-[auto_minmax(0,1fr)] gap-2"
            >
              <StatusIcon status={c.ok ? "ok" : c.configured ? "fail" : "warn"} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{c.name}</span>
                  {c.latencyMs != null && (
                    <span className="text-[10px] text-muted-foreground">{c.latencyMs} ms</span>
                  )}
                  {!c.configured && (
                    <span className="text-[10px] uppercase tracking-wide text-amber-500">
                      not configured
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground break-words">{c.detail}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Destructive actions — database wipe with confirmation + rate limit
// ---------------------------------------------------------------------------

function DestructiveActionsPanel() {
  const req = useServerFn(requestDatabaseWipe);
  const confirm = useServerFn(confirmDatabaseWipe);
  const [code, setCode] = useState("");
  const [phrase, setPhrase] = useState("");
  const [issued, setIssued] = useState<{ code: string; expiresAt: string; phrase: string } | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const requestMut = useMutation({
    mutationFn: () => req(),
    onSuccess: (data) => {
      setIssued({ code: data.confirmationCode, expiresAt: data.expiresAt, phrase: data.confirmationPhrase });
      setResult(null);
    },
  });
  const confirmMut = useMutation({
    mutationFn: () =>
      confirm({ data: { code: code.trim().toUpperCase(), confirmationPhrase: phrase } }),
    onSuccess: () => {
      setResult("✓ Database wiped successfully. The audit log below records this action.");
      setIssued(null);
      setCode("");
      setPhrase("");
    },
  });

  return (
    <section className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-destructive" />
        <h2 className="font-semibold text-sm">Destructive actions — Database wipe</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Two-step, rate-limited (1/hr per admin · {3}/day project-wide). Confirmation codes expire
        after 5 minutes. Wipes application data; users, roles, and configuration are preserved.
      </p>

      {!issued && (
        <Button
          variant="destructive"
          size="sm"
          onClick={() => requestMut.mutate()}
          disabled={requestMut.isPending}
          aria-label="Request database wipe confirmation code"
        >
          {requestMut.isPending ? "Requesting…" : "Request wipe confirmation code"}
        </Button>
      )}
      {requestMut.error && (
        <p className="text-xs text-destructive break-words">{(requestMut.error as Error).message}</p>
      )}

      {issued && (
        <div className="space-y-2 rounded-md border border-border bg-background p-3">
          <p className="text-xs">
            One-time code: <span className="font-mono text-base font-bold">{issued.code}</span>
            <span className="text-muted-foreground"> · expires {new Date(issued.expiresAt).toLocaleTimeString()}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            Type the code and the exact phrase <code className="font-mono">{issued.phrase}</code> to confirm.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              aria-label="Confirmation code"
              placeholder="Code (6 chars)"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={20}
            />
            <Input
              aria-label="Confirmation phrase"
              placeholder={issued.phrase}
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="destructive"
              size="sm"
              onClick={() => confirmMut.mutate()}
              disabled={
                confirmMut.isPending || !code.trim() || phrase !== issued.phrase
              }
              aria-label="Confirm database wipe"
            >
              {confirmMut.isPending ? "Wiping…" : "Confirm wipe"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setIssued(null)}>
              Cancel
            </Button>
          </div>
          {confirmMut.error && (
            <p className="text-xs text-destructive break-words">{(confirmMut.error as Error).message}</p>
          )}
        </div>
      )}
      {result && <p className="text-xs text-emerald-500">{result}</p>}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Admin audit log (database wipes + other privileged actions)
// ---------------------------------------------------------------------------

function AdminAuditPanel() {
  const list = useServerFn(listAdminAuditLog);
  const q = useQuery({
    queryKey: ["admin-audit-log"],
    queryFn: () => list({ data: { limit: 50 } }),
    retry: false,
    refetchInterval: 30_000,
  });

  return (
    <section className="rounded-md border border-border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm">Admin audit log</h2>
        <span className="text-[10px] text-muted-foreground">{q.data?.length ?? 0} rows</span>
      </div>
      {q.error && (
        <p className="text-xs text-destructive break-words">{(q.error as Error).message}</p>
      )}
      <div className="overflow-x-auto -mx-3 sm:mx-0">
        <table className="w-full text-[11px] min-w-[680px]">
          <thead className="text-muted-foreground">
            <tr className="text-left">
              <th className="p-1.5">Time</th>
              <th className="p-1.5">Admin</th>
              <th className="p-1.5">Action</th>
              <th className="p-1.5">Status</th>
              <th className="p-1.5">IP</th>
              <th className="p-1.5">Details</th>
            </tr>
          </thead>
          <tbody>
            {(q.data ?? []).map((r: any) => (
              <tr key={r.id} className="border-t border-border/50 align-top">
                <td className="p-1.5 whitespace-nowrap text-muted-foreground">
                  {new Date(r.created_at).toLocaleString()}
                </td>
                <td className="p-1.5 break-all max-w-[180px]">{r.actor_email ?? "—"}</td>
                <td className="p-1.5 font-mono">{r.action}</td>
                <td className={`p-1.5 ${badgeClass(r.status)}`}>{r.status}</td>
                <td className="p-1.5 text-muted-foreground">{r.ip ?? "—"}</td>
                <td className="p-1.5 text-muted-foreground break-words max-w-[260px]">
                  <code className="font-mono text-[10px]">
                    {JSON.stringify(r.metadata ?? {}).slice(0, 160)}
                  </code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Verification redirect diagnostics
// ---------------------------------------------------------------------------

function VerificationRedirectPanel() {
  const run = useServerFn(getVerificationDiagnostics);
  const q = useQuery({
    queryKey: ["verification-diagnostics"],
    queryFn: () => run(),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const d = q.data;

  return (
    <section className="rounded-md border border-border p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Link2 className="h-4 w-4 text-primary" />
        <h2 className="font-semibold text-sm">Verification redirects</h2>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          onClick={() => q.refetch()}
          disabled={q.isFetching}
        >
          <RefreshCw className={`h-3.5 w-3.5 sm:mr-1.5 ${q.isFetching ? "animate-spin" : ""}`} />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      </div>

      {q.isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
      {q.error && (
        <p className="text-xs text-destructive break-words">{(q.error as Error).message}</p>
      )}

      {d && (
        <>
          <div className="rounded-md border border-border/60 p-2.5 grid grid-cols-[auto_minmax(0,1fr)] gap-2">
            <StatusIcon status={d.baseUrl.looksBroken ? "fail" : d.baseUrl.isFallback ? "warn" : "ok"} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">Public base URL</span>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  source: {d.baseUrl.source}
                </span>
              </div>
              <div className="text-xs font-mono break-all">{d.baseUrl.url}</div>
              {d.baseUrl.isFallback && (
                <div className="text-[11px] text-amber-500 mt-1">
                  Using built-in fallback. Set <code>PUBLIC_BASE_URL</code> env var to your published domain to override.
                </div>
              )}
              {d.baseUrl.looksBroken && (
                <div className="text-[11px] text-red-500 mt-1">
                  ⚠ Configured URL looks like a preview/localhost host — shared links will break.
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Tokens (24h)" value={d.counters.tokensLast24h} />
            <Stat label="Consumed" value={d.counters.consumedLast24h} tone="ok" />
            <Stat label="Expired unused" value={d.counters.expiredLast24h} tone="warn" />
            <Stat label="Provider errors" value={d.counters.providerErrorsLast24h} tone={d.counters.providerErrorsLast24h ? "fail" : "ok"} />
          </div>

          {d.recentTokens.length > 0 && (
            <div className="overflow-x-auto -mx-3 sm:mx-0">
              <table className="w-full text-[11px] min-w-[640px]">
                <thead className="text-muted-foreground">
                  <tr className="text-left">
                    <th className="p-1.5">Token</th>
                    <th className="p-1.5">Provider</th>
                    <th className="p-1.5">User</th>
                    <th className="p-1.5">File</th>
                    <th className="p-1.5">Age</th>
                    <th className="p-1.5">Consumed</th>
                  </tr>
                </thead>
                <tbody>
                  {d.recentTokens.map((t) => (
                    <tr key={t.token_prefix + t.created_at} className="border-t border-border/50">
                      <td className="p-1.5 font-mono">{t.token_prefix}…</td>
                      <td className="p-1.5">{t.provider}</td>
                      <td className="p-1.5 font-mono text-muted-foreground break-all max-w-[140px]">{t.user_id.slice(0, 8)}…</td>
                      <td className="p-1.5 font-mono text-muted-foreground break-all max-w-[140px]">{t.media_file_id ? t.media_file_id.slice(0, 8) + "…" : "—"}</td>
                      <td className="p-1.5 text-muted-foreground">{t.age_minutes}m</td>
                      <td className={`p-1.5 ${t.consumed_at ? "text-emerald-500" : "text-muted-foreground"}`}>
                        {t.consumed_at ? "yes" : "no"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {d.recentProviderCalls.length > 0 && (
            <div className="overflow-x-auto -mx-3 sm:mx-0">
              <table className="w-full text-[11px] min-w-[640px]">
                <thead className="text-muted-foreground">
                  <tr className="text-left">
                    <th className="p-1.5">Time</th>
                    <th className="p-1.5">Provider</th>
                    <th className="p-1.5">Status</th>
                    <th className="p-1.5">HTTP</th>
                    <th className="p-1.5">Latency</th>
                    <th className="p-1.5">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {d.recentProviderCalls.map((c) => (
                    <tr key={c.id} className="border-t border-border/50">
                      <td className="p-1.5 whitespace-nowrap text-muted-foreground">{new Date(c.created_at).toLocaleTimeString()}</td>
                      <td className="p-1.5">{c.provider}</td>
                      <td className={`p-1.5 ${c.status === "ok" ? "text-emerald-500" : c.status === "no_key" ? "text-amber-500" : "text-red-500"}`}>{c.status}</td>
                      <td className="p-1.5 text-muted-foreground">{c.http_status ?? "—"}</td>
                      <td className="p-1.5 text-muted-foreground">{c.latency_ms ?? "—"}ms</td>
                      <td className="p-1.5 text-muted-foreground break-words max-w-[260px]">{c.error ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" | "fail" }) {
  const cls = tone === "ok" ? "text-emerald-500" : tone === "warn" ? "text-amber-500" : tone === "fail" ? "text-red-500" : "";
  return (
    <div className="rounded-md border border-border/60 p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-0.5 font-mono text-base font-semibold ${cls}`}>{value.toLocaleString()}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shortener (AdrinoLinks / NanoLinks) rolling health
// ---------------------------------------------------------------------------

function ShortenerHealthPanel() {
  const get = useServerFn(getShortenerHealth);
  const probe = useServerFn(probeShortener);
  const exportCsv = useServerFn(exportShortenerHealthCsv);
  const q = useQuery({
    queryKey: ["shortener-health"],
    queryFn: () => get({ data: { limit: 50 } }),
    retry: false,
    refetchInterval: 30_000,
  });
  const [busy, setBusy] = useState<string | null>(null);

  async function runProbe(provider: "adrinolinks" | "nanolinks") {
    setBusy(provider);
    try {
      await probe({ data: { provider } });
      await q.refetch();
    } finally {
      setBusy(null);
    }
  }

  async function downloadCsv() {
    setBusy("export");
    try {
      const { csv } = await exportCsv({ data: { limit: 5000 } });
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `shortener_health_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-md border border-border p-3 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Gauge className="h-4 w-4 text-primary" />
        <h2 className="font-semibold text-sm">Shortener health (rolling)</h2>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={downloadCsv} disabled={busy === "export"}>
            <Download className="h-3.5 w-3.5 sm:mr-1.5" />
            <span className="hidden sm:inline">Export CSV</span>
          </Button>
        </div>
      </div>

      {q.error && <p className="text-xs text-destructive">{(q.error as Error).message}</p>}

      <div className="grid gap-2 sm:grid-cols-2">
        {(q.data ?? []).map((p) => {
          const pct = Math.round(p.successRate * 100);
          const tone =
            p.status === "ok" ? "text-emerald-500" :
            p.status === "warn" ? "text-amber-500" :
            p.status === "fail" ? "text-red-500" : "text-muted-foreground";
          return (
            <div key={p.provider} className="rounded-md border border-border/60 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="font-mono text-sm font-semibold capitalize">{p.provider}</div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] uppercase tracking-wide ${tone}`}>{p.status}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => runProbe(p.provider as "adrinolinks" | "nanolinks")}
                    disabled={busy === p.provider}
                  >
                    <RefreshCw className={`h-3 w-3 sm:mr-1 ${busy === p.provider ? "animate-spin" : ""}`} />
                    <span className="hidden sm:inline">Run check now</span>
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[11px]">
                <div>
                  <div className="text-muted-foreground">Success</div>
                  <div className={`font-mono text-sm font-semibold ${tone}`}>{p.samples ? `${pct}%` : "—"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Avg latency</div>
                  <div className="font-mono text-sm">{p.samples ? `${p.avgLatencyMs} ms` : "—"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Samples</div>
                  <div className="font-mono text-sm">{p.samples}</div>
                </div>
              </div>
              <div className="text-[11px] text-muted-foreground">
                Last check: {p.lastCheckedAt ? new Date(p.lastCheckedAt).toLocaleString() : "never"}
              </div>
              {p.lastError && (
                <div className="text-[11px] text-red-500 break-words">
                  Last error: <span className="font-mono">{p.lastError}</span>
                </div>
              )}
              {p.recent.length > 0 && (
                <div className="flex gap-0.5 mt-1">
                  {p.recent.slice().reverse().map((r, i) => (
                    <div
                      key={i}
                      title={`${new Date(r.checked_at).toLocaleTimeString()} · ${r.ok ? "ok" : r.error ?? "fail"} · ${r.latency_ms ?? 0}ms`}
                      className={`h-3 flex-1 rounded-sm ${r.ok ? "bg-emerald-500/70" : "bg-red-500/70"}`}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {(!q.data || q.data.length === 0) && !q.isLoading && (
          <p className="text-xs text-muted-foreground sm:col-span-2">
            No shortener health samples yet. Click "Run check now" to seed.
          </p>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Settings audit log — /admin/settings changes
// ---------------------------------------------------------------------------

function SettingsAuditPanel() {
  const list = useServerFn(listSettingsAuditLog);
  const q = useQuery({
    queryKey: ["settings-audit"],
    queryFn: () => list({ data: { limit: 100 } }),
    retry: false,
    refetchInterval: 60_000,
  });

  return (
    <section className="rounded-md border border-border p-3 space-y-2">
      <div className="flex items-center gap-2">
        <SettingsIcon className="h-4 w-4 text-primary" />
        <h2 className="font-semibold text-sm">Settings change log</h2>
        <span className="ml-auto text-[10px] text-muted-foreground">{q.data?.length ?? 0} changes</span>
      </div>
      {q.error && <p className="text-xs text-destructive break-words">{(q.error as Error).message}</p>}
      {!q.isLoading && (q.data?.length ?? 0) === 0 && (
        <p className="text-xs text-muted-foreground">No setting changes recorded yet.</p>
      )}
      <div className="overflow-x-auto -mx-3 sm:mx-0">
        <table className="w-full text-[11px] min-w-[640px]">
          <thead className="text-muted-foreground">
            <tr className="text-left">
              <th className="p-1.5">When</th>
              <th className="p-1.5">Admin</th>
              <th className="p-1.5">Key</th>
              <th className="p-1.5">Type</th>
              <th className="p-1.5">Has value</th>
              <th className="p-1.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {(q.data ?? []).map((r) => (
              <tr key={r.id} className="border-t border-border/50">
                <td className="p-1.5 whitespace-nowrap text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</td>
                <td className="p-1.5 break-all max-w-[180px]">{r.actorEmail ?? r.actorUserId?.slice(0, 8) ?? "—"}</td>
                <td className="p-1.5 font-mono">{r.key ?? "—"}</td>
                <td className="p-1.5">{r.isSecret ? <span className="text-amber-500">secret</span> : "plain"}</td>
                <td className="p-1.5">{r.hasValue ? "yes" : <span className="text-muted-foreground">cleared</span>}</td>
                <td className={`p-1.5 ${badgeClass(r.status)}`}>{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Ingestion deduplication stats
// ---------------------------------------------------------------------------

function IngestionDedupPanel() {
  const get = useServerFn(getIngestionDedupStats);
  const q = useQuery({
    queryKey: ["ingestion-dedup-stats"],
    queryFn: () => get(),
    retry: false,
    refetchInterval: 60_000,
  });
  const d = q.data;

  return (
    <section className="rounded-md border border-border p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Layers className="h-4 w-4 text-primary" />
        <h2 className="font-semibold text-sm">Ingestion deduplication</h2>
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => q.refetch()} disabled={q.isFetching}>
          <RefreshCw className={`h-3.5 w-3.5 sm:mr-1.5 ${q.isFetching ? "animate-spin" : ""}`} />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      </div>
      {q.error && <p className="text-xs text-destructive break-words">{(q.error as Error).message}</p>}
      {d && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Ingest rows" value={d.ingest.totalRows} />
            <Stat label="With idem. key" value={d.ingest.withIdempotencyKey} tone="ok" />
            <Stat label="Missing key" value={d.ingest.missingIdempotencyKey} tone={d.ingest.missingIdempotencyKey ? "warn" : "ok"} />
            <Stat label="Resync skipped (dedup)" value={d.resyncTotals.skippedByIdempotency} tone="ok" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Resync runs" value={d.resyncTotals.runs} />
            <Stat label="Scanned" value={d.resyncTotals.scanned} />
            <Stat label="Metadata patched" value={d.resyncTotals.metadataUpdated} />
            <Stat label="Backfill processed" value={d.resyncTotals.backfillProcessed} />
          </div>
          {d.recentRuns.length > 0 && (
            <div className="overflow-x-auto -mx-3 sm:mx-0">
              <table className="w-full text-[11px] min-w-[640px]">
                <thead className="text-muted-foreground">
                  <tr className="text-left">
                    <th className="p-1.5">When</th>
                    <th className="p-1.5">Admin</th>
                    <th className="p-1.5">Channels</th>
                    <th className="p-1.5">Scanned</th>
                    <th className="p-1.5">Patched</th>
                    <th className="p-1.5">Backfill</th>
                    <th className="p-1.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {d.recentRuns.map((r) => (
                    <tr key={r.id} className="border-t border-border/50">
                      <td className="p-1.5 whitespace-nowrap text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</td>
                      <td className="p-1.5 break-all max-w-[180px]">{r.actorEmail ?? "—"}</td>
                      <td className="p-1.5">{r.channelCount}</td>
                      <td className="p-1.5">{r.scanned}</td>
                      <td className="p-1.5 text-emerald-500">{r.metadataUpdated}</td>
                      <td className="p-1.5">{r.backfillProcessed}</td>
                      <td className={`p-1.5 ${badgeClass(r.status)}`}>{r.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            "Resync skipped (dedup)" = rows scanned by recent resyncs that already had complete metadata, so the
            idempotency_key constraint short-circuited any re-insert. New posts pulled in by backfill are counted separately.
          </p>
        </>
      )}
    </section>
  );
}


