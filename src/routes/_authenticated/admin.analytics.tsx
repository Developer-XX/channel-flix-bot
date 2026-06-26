import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  ArrowLeft,
  Users,
  UserCheck,
  Download,
  Film,
  Eye,
  TrendingUp,
  CheckCircle2,
  XCircle,
  FileText,
  ShieldAlert,
  Gauge,
  FileDown,
  Activity,
} from "lucide-react";
import { getAdminAnalytics, type AdminAnalytics } from "@/lib/admin-analytics.functions";
import { getDeliveryAudit, type DeliveryAuditRow } from "@/lib/delivery-audit.functions";

import { exportBlockedBrowsingCsv } from "@/lib/blocked-browsing-export.functions";
import { getAdPerfSummary } from "@/lib/ad-perf.functions";
import { getGoogleOAuthLatestHealth } from "@/lib/google-oauth-admin.functions";
import { Button } from "@/components/ui/button";
import { AuthEventsWidget } from "@/components/AuthEventsWidget";
import { EngagementWidget } from "@/components/EngagementWidget";


export const Route = createFileRoute("/_authenticated/admin/analytics")({
  component: AnalyticsPage,
});

function AnalyticsPage() {
  const q = useQuery({
    queryKey: ["admin-analytics"],
    queryFn: () => getAdminAnalytics(),
    refetchInterval: 60_000,
    retry: false,
  });

  const a = q.data;

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-6xl mx-auto">
      <div className="flex items-center gap-2">
        <Link to="/admin">
          <Button size="sm" variant="ghost">
            <ArrowLeft className="h-3 w-3 mr-1" /> Admin
          </Button>
        </Link>
        <div className="ml-1">
          <h1 className="font-display text-2xl sm:text-3xl font-bold">Analytics</h1>
          <p className="text-xs text-muted-foreground">
            {a ? `Updated ${new Date(a.generatedAt).toLocaleTimeString()}` : "Loading…"}
          </p>
        </div>
      </div>

      {q.error && (
        <div className="mt-6 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {(q.error as Error).message}
        </div>
      )}

      {/* Users */}
      <Section title="Users" icon={<Users className="h-4 w-4" />}>
        <StatGrid>
          <Stat label="Total users" value={a?.users.total} icon={<Users className="h-4 w-4" />} accent />
          <Stat label="Active today" value={a?.users.activeToday} icon={<UserCheck className="h-4 w-4" />} />
          <Stat label="Active 7d" value={a?.users.active7d} />
          <Stat label="Active 30d" value={a?.users.active30d} />
          <Stat label="New today" value={a?.users.newToday} />
          <Stat label="New 7d" value={a?.users.new7d} />
        </StatGrid>
      </Section>

      <AuthEventsWidget />

      <EngagementWidget />


      <GoogleOAuthHealthWidget />

      <InterstitialPerfWidget />






      {/* Downloads */}
      <Section title="Downloads" icon={<Download className="h-4 w-4" />}>
        <StatGrid>
          <Stat label="Total" value={a?.downloads.total} icon={<Download className="h-4 w-4" />} accent />
          <Stat label="Today" value={a?.downloads.today} />
          <Stat label="Last 7d" value={a?.downloads.last7d} />
          <Stat label="Last 30d" value={a?.downloads.last30d} />
          <Stat
            label="Delivered today"
            value={a?.downloads.deliveredToday}
            icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
          />
          <Stat
            label="Failed today"
            value={a?.downloads.failedToday}
            icon={<XCircle className="h-4 w-4 text-red-500" />}
          />
          <Stat label="Resends today" value={a?.downloads.resendsToday} />
          <Stat label="Resends 7d" value={a?.downloads.resends7d} />
        </StatGrid>
        {a?.downloadsByDay && <DailyBars data={a.downloadsByDay} />}
      </Section>

      <DeliveryAuditWidget />


      {/* Auto-delete cron (process-message-deletes) */}
      <Section title="Auto-delete (delivered messages)" icon={<XCircle className="h-4 w-4" />}>
        <StatGrid>
          <Stat label="Pending (due)" value={a?.autoDelete.pendingDue} accent />
          <Stat label="Completed today" value={a?.autoDelete.completedToday} />
          <Stat label="Completed 7d" value={a?.autoDelete.completed7d} />
          <Stat label="Exhausted (24h)" value={a?.autoDelete.exhaustedFailed24h} />
        </StatGrid>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Last cron run:{" "}
          <span className="font-mono">
            {a?.autoDelete.lastRunAt ? new Date(a.autoDelete.lastRunAt).toLocaleString() : "never"}
          </span>
        </p>
      </Section>


      {/* Catalog */}
      <Section title="Catalog" icon={<Film className="h-4 w-4" />}>
        <StatGrid>
          <Stat label="Titles" value={a?.catalog.titles} icon={<Film className="h-4 w-4" />} accent />
          <Stat label="Published" value={a?.catalog.published} />
          <Stat label="Draft" value={a?.catalog.draft} />
          <Stat label="Archived" value={a?.catalog.archived} />
          <Stat label="Media files" value={a?.catalog.files} />
          <Stat
            label="Pending requests"
            value={a?.catalog.pendingRequests}
            icon={<FileText className="h-4 w-4" />}
          />
        </StatGrid>
      </Section>

      {/* Top titles */}
      <div className="grid lg:grid-cols-2 gap-4 mt-6">
        <TitleList
          heading="Most viewed"
          icon={<Eye className="h-4 w-4 text-primary" />}
          rows={(a?.topViewed ?? []).map((r) => ({
            id: r.id,
            title: r.title,
            slug: r.slug,
            poster_url: r.poster_url,
            value: r.view_count,
            unit: "views",
          }))}
        />
        <TitleList
          heading="Most downloaded"
          icon={<Download className="h-4 w-4 text-primary" />}
          rows={(a?.topDownloaded ?? []).map((r) => ({
            id: r.id,
            title: r.title,
            slug: r.slug,
            poster_url: r.poster_url,
            value: r.download_count,
            unit: "downloads",
          }))}
        />
      </div>

      <div className="mt-6">
        <TitleList
          heading="Trending (last 7d)"
          icon={<TrendingUp className="h-4 w-4 text-primary" />}
          rows={(a?.trending ?? []).map((r) => ({
            id: r.title_id,
            title: r.title,
            slug: r.slug,
            poster_url: r.poster_url,
            value: Math.round(r.score),
            unit: `rank #${r.rank}`,
          }))}
        />
      </div>

      {/* Blocked browsing (auth-only mode redirects) */}
      <Section title="Blocked browsing attempts" icon={<ShieldAlert className="h-4 w-4" />}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            Public browsing is currently{" "}
            <span className={a?.blockedBrowsing.publicBrowsingEnabled ? "text-emerald-500 font-semibold" : "text-red-500 font-semibold"}>
              {a?.blockedBrowsing.publicBrowsingEnabled ? "ON (anyone can browse titles)" : "OFF (sign-in required)"}
            </span>
            . Counts below are anonymous visitors who were redirected to sign-in.
          </div>
          <ExportCsvButton />
        </div>
        <StatGrid>
          <Stat label="Today" value={a?.blockedBrowsing.today} icon={<ShieldAlert className="h-4 w-4" />} accent />
          <Stat label="Last 7d" value={a?.blockedBrowsing.last7d} />
          <Stat label="Last 30d" value={a?.blockedBrowsing.last30d} />
          {(a?.blockedBrowsing.byReason ?? []).slice(0, 3).map((r) => (
            <Stat key={r.reason} label={r.reason} value={r.count} />
          ))}
        </StatGrid>

        {/* Rate-limit utilization */}
        {a?.blockedBrowsing.rateLimit && (
          <div className="mt-4 rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
              <Gauge className="h-3.5 w-3.5" /> log_blocked_browsing · rate-limit utilization (last minute)
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-2xl font-bold tabular-nums">
                {a.blockedBrowsing.rateLimit.usedLastMinute}
              </span>
              <span className="text-xs text-muted-foreground">
                / {a.blockedBrowsing.rateLimit.cap} per {a.blockedBrowsing.rateLimit.windowSec}s
              </span>
              <span
                className={`ml-auto text-xs font-semibold ${
                  a.blockedBrowsing.rateLimit.utilizationPct >= 90
                    ? "text-red-500"
                    : a.blockedBrowsing.rateLimit.utilizationPct >= 60
                    ? "text-amber-500"
                    : "text-emerald-500"
                }`}
              >
                {a.blockedBrowsing.rateLimit.utilizationPct}%
              </span>
            </div>
            <div className="mt-2 h-2 w-full rounded-full bg-surface overflow-hidden">
              <div
                className={`h-full transition-all ${
                  a.blockedBrowsing.rateLimit.utilizationPct >= 90
                    ? "bg-red-500"
                    : a.blockedBrowsing.rateLimit.utilizationPct >= 60
                    ? "bg-amber-500"
                    : "bg-emerald-500"
                }`}
                style={{ width: `${a.blockedBrowsing.rateLimit.utilizationPct}%` }}
              />
            </div>
            <div className="mt-2 text-[11px] text-muted-foreground">
              Dropped (estimate): <span className="font-semibold tabular-nums">{a.blockedBrowsing.rateLimit.droppedEstimate}</span>
              {" · "}cap enforced server-side by <code className="font-mono">log_blocked_browsing</code>
            </div>
          </div>
        )}

        {a?.blockedBrowsing.recent && a.blockedBrowsing.recent.length > 0 && (
          <div className="mt-4 rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Recent attempts
            </div>
            <div className="divide-y divide-border">
              {a.blockedBrowsing.recent.map((r) => (
                <div key={r.id} className="px-3 py-2 text-xs flex items-center gap-3">
                  <span className="text-muted-foreground tabular-nums">
                    {new Date(r.created_at).toLocaleString()}
                  </span>
                  <span className="font-mono text-primary">{r.reason}</span>
                  <span className="truncate flex-1 text-muted-foreground">{r.path ?? r.slug ?? "—"}</span>
                  <span className={`text-[10px] uppercase tracking-wider ${r.toggle_on ? "text-emerald-500" : "text-red-500"}`}>
                    toggle {r.toggle_on ? "on" : "off"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

function ExportCsvButton() {
  const [busy, setBusy] = useState(false);
  const [windowDays, setWindowDays] = useState(30);

  async function onExport() {
    setBusy(true);
    try {
      const res = await exportBlockedBrowsingCsv({ data: { windowDays } });
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("CSV export failed", e);
      alert(`CSV export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={windowDays}
        onChange={(e) => setWindowDays(Number(e.target.value))}
        className="h-8 rounded-md border border-border bg-card px-2 text-xs"
        disabled={busy}
        aria-label="Export window"
      >
        <option value={7}>Last 7d</option>
        <option value={30}>Last 30d</option>
        <option value={90}>Last 90d</option>
      </select>
      <Button size="sm" variant="outline" onClick={onExport} disabled={busy}>
        <FileDown className="h-3.5 w-3.5 mr-1" />
        {busy ? "Exporting…" : "Export CSV"}
      </Button>
    </div>
  );
}

function Section({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <div className="flex items-center justify-between mb-3 gap-2">
        <h2 className="font-display text-lg font-bold flex items-center gap-2">
          {icon} {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function StatGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">{children}</div>;
}

function Stat({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value?: number | string;
  icon?: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-3 ${
        accent ? "border-primary/40 bg-primary/5" : "border-border bg-card"
      }`}
    >
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        {icon} {label}
      </div>
      <div className="mt-1 font-display text-2xl font-bold tabular-nums">
        {value === undefined ? "—" : value}
      </div>
    </div>
  );
}

function DailyBars({ data }: { data: AdminAnalytics["downloadsByDay"] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="mt-4 rounded-xl border border-border bg-card p-4">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
        Downloads · last 14 days
      </div>
      <div className="flex items-end gap-1 h-32">
        {data.map((d) => (
          <div key={d.day} className="flex-1 flex flex-col items-center gap-1 group">
            <div
              className="w-full bg-primary/70 group-hover:bg-primary rounded-t transition"
              style={{ height: `${(d.count / max) * 100}%`, minHeight: d.count > 0 ? 2 : 0 }}
              title={`${d.day}: ${d.count}`}
            />
            <span className="text-[9px] text-muted-foreground tabular-nums">
              {d.day.slice(5)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

type TitleRow = {
  id: string;
  title: string;
  slug: string;
  poster_url: string | null;
  value: number;
  unit: string;
};

function TitleList({
  heading,
  icon,
  rows,
}: {
  heading: string;
  icon: React.ReactNode;
  rows: TitleRow[];
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="font-display text-base font-bold flex items-center gap-2 mb-3">
        {icon} {heading}
      </h3>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No data yet.</p>
      ) : (
        <ol className="space-y-1.5">
          {rows.map((r, i) => (
            <li key={r.id} className="flex items-center gap-2 text-sm">
              <span className="w-5 text-right text-xs text-muted-foreground tabular-nums">
                {i + 1}.
              </span>
              {r.poster_url ? (
                <img src={r.poster_url} alt="" className="h-8 w-6 rounded object-cover" />
              ) : (
                <div className="h-8 w-6 rounded bg-surface" />
              )}
              <Link
                to="/title/$slug"
                params={{ slug: r.slug }}
                className="flex-1 truncate hover:text-primary"
              >
                {r.title || r.slug}
              </Link>
              <span className="text-xs text-muted-foreground tabular-nums">
                {r.value.toLocaleString()} {r.unit}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function InterstitialPerfWidget() {
  const q = useQuery({
    queryKey: ["admin-ad-perf-summary", 24],
    queryFn: () => getAdPerfSummary({ data: { windowHours: 24 } }),
    refetchInterval: 60_000,
    retry: false,
  });
  const rows = q.data?.rows ?? [];
  return (
    <Section
      title="Interstitial performance (24h)"
      icon={<Activity className="h-4 w-4" />}
      action={
        <Link
          to="/admin/interstitial-performance"
          className="text-xs text-primary underline-offset-4 hover:underline"
        >
          Open drilldown →
        </Link>
      }
    >
      {q.error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          {(q.error as Error).message}
        </div>
      )}
      {!q.error && rows.length === 0 && (
        <p className="text-xs text-muted-foreground">No interstitial telemetry recorded yet in the last 24h.</p>
      )}
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.placement} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-baseline justify-between gap-2 mb-2">
              <span className="font-mono text-xs text-primary">{r.placement}</span>
              <span className="text-[11px] text-muted-foreground">
                {r.samples.toLocaleString()} samples
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <Stat label="TTFF p50" value={r.ttff_p50 != null ? `${r.ttff_p50}ms` : "—"} accent />
              <Stat label="TTFF p95" value={r.ttff_p95 != null ? `${r.ttff_p95}ms` : "—"} />
              <Stat label="Buffer avg" value={r.buffer_avg_ms != null ? `${r.buffer_avg_ms}ms` : "—"} />
              <Stat label="Dropped frames" value={r.dropped_frames_total} />
              <Stat label="Autoplay blocked" value={r.autoplay_blocked_count} />
              <Stat label="Video errors" value={r.error_count} />
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function GoogleOAuthHealthWidget() {
  const q = useQuery({
    queryKey: ["google-oauth-latest-health"],
    queryFn: () => getGoogleOAuthLatestHealth(),
    refetchInterval: 60_000,
    retry: false,
  });
  const r = q.data;
  const color =
    !r ? "text-muted-foreground" : r.status === "ok" ? "text-emerald-600" : "text-destructive";
  const dot =
    !r ? "bg-muted-foreground/40" : r.status === "ok" ? "bg-emerald-500" : "bg-destructive";
  return (
    <section className="mt-6 rounded-lg border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold flex items-center gap-2">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${dot}`} />
            Google OAuth health
          </h2>
          {!r && <p className="text-xs text-muted-foreground mt-1">No checks recorded yet.</p>}
          {r && (
            <p className={`text-xs mt-1 ${color}`}>
              {r.status === "ok" ? "Healthy" : "Failing"} · {r.kind} check ·{" "}
              {new Date(r.checkedAt).toLocaleString()}
              {r.latencyMs != null ? ` · ${r.latencyMs} ms` : ""}
            </p>
          )}
          {r?.errorMessage && (
            <p className="text-xs text-destructive mt-1">{r.errorCode}: {r.errorMessage}</p>
          )}
        </div>
        <Link to="/admin/google-oauth">
          <Button size="sm" variant="outline">Open Google OAuth</Button>
        </Link>
      </div>
    </section>
  );
}

function DeliveryAuditWidget() {
  const [status, setStatus] = useState<"all" | "delivered" | "blocked" | "failed">("all");
  const q = useQuery({
    queryKey: ["delivery-audit", status],
    queryFn: () => getDeliveryAudit({ data: { limit: 50, status } }),
    refetchInterval: 30_000,
    retry: false,
  });
  const rows = q.data?.rows ?? [];
  const summary = q.data?.summary;
  return (
    <section className="mt-8 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <h2 className="font-display text-lg font-bold flex items-center gap-2">
          <FileDown className="h-4 w-4" /> Delivery audit (last 24h)
        </h2>
        <div className="flex gap-1 text-xs">
          {(["all", "delivered", "blocked", "failed"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`px-2 py-1 rounded-md border ${status === s ? "border-primary bg-primary/15" : "border-border bg-surface/40 text-muted-foreground hover:text-foreground"}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      {summary && (
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
          <SummaryStat label="Total 24h" value={summary.total24h} />
          <SummaryStat label="Delivered" value={summary.delivered24h} tone="ok" />
          <SummaryStat label="Blocked" value={summary.blocked24h} tone="warn" />
          <SummaryStat label="Failed" value={summary.failed24h} tone="err" />
          <SummaryStat label="Force-join blocks" value={summary.forceJoinBlocked24h} tone="warn" />
        </div>
      )}
      {summary && summary.topReasons.length > 0 && (
        <div className="mt-3 text-xs">
          <span className="text-muted-foreground">Top reasons:</span>{" "}
          {summary.topReasons.map((r: { reason: string; count: number }) => (
            <span key={r.reason} className="inline-block mr-2 px-2 py-0.5 rounded-md border border-border bg-surface/40">
              {r.reason} <b>{r.count}</b>
            </span>
          ))}
        </div>
      )}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border">
              <th className="py-2 pr-2">When</th>
              <th className="py-2 pr-2">Status</th>
              <th className="py-2 pr-2">Join</th>
              <th className="py-2 pr-2">Shortener</th>
              <th className="py-2 pr-2">Category</th>
              <th className="py-2 pr-2">Reason / Error</th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading && (
              <tr><td colSpan={6} className="py-3 text-muted-foreground">Loading…</td></tr>
            )}
            {!q.isLoading && rows.length === 0 && (
              <tr><td colSpan={6} className="py-3 text-muted-foreground">No download attempts yet.</td></tr>
            )}
            {rows.map((r: DeliveryAuditRow) => (

              <tr key={r.id} className="border-b border-border/40 align-top">
                <td className="py-1.5 pr-2 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                <td className="py-1.5 pr-2">
                  <span className={
                    r.delivery_status === "delivered" ? "text-emerald-500" :
                    r.delivery_status === "blocked" ? "text-amber-500" :
                    "text-red-400"
                  }>
                    {r.delivery_status ?? "?"}
                  </span>
                </td>
                <td className="py-1.5 pr-2">
                  {r.force_join_required
                    ? <span className={r.force_join_status === "joined" ? "text-emerald-500" : "text-amber-500"}>{r.force_join_status ?? "?"}</span>
                    : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="py-1.5 pr-2">{r.shortener_used ?? <span className="text-muted-foreground">—</span>}</td>
                <td className="py-1.5 pr-2">{r.category ?? <span className="text-muted-foreground">—</span>}</td>
                <td className="py-1.5 pr-2 max-w-[300px] truncate" title={r.delivery_error ?? r.failure_reason ?? ""}>
                  {r.failure_reason ?? r.delivery_error ?? <span className="text-muted-foreground">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SummaryStat({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" | "err" }) {
  const color =
    tone === "ok" ? "text-emerald-500" :
    tone === "warn" ? "text-amber-500" :
    tone === "err" ? "text-red-400" : "";
  return (
    <div className="rounded-md border border-border bg-surface/40 p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`font-display text-lg font-semibold ${color}`}>{value}</div>
    </div>
  );
}



