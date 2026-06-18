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
} from "lucide-react";
import { getAdminAnalytics, type AdminAnalytics } from "@/lib/admin-analytics.functions";
import { exportBlockedBrowsingCsv } from "@/lib/blocked-browsing-export.functions";
import { Button } from "@/components/ui/button";

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
        </StatGrid>
        {a?.downloadsByDay && <DailyBars data={a.downloadsByDay} />}
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
        <div className="mb-3 text-xs text-muted-foreground">
          Public browsing is currently{" "}
          <span className={a?.blockedBrowsing.publicBrowsingEnabled ? "text-emerald-500 font-semibold" : "text-red-500 font-semibold"}>
            {a?.blockedBrowsing.publicBrowsingEnabled ? "ON (anyone can browse titles)" : "OFF (sign-in required)"}
          </span>
          . Counts below are anonymous visitors who were redirected to sign-in.
        </div>
        <StatGrid>
          <Stat label="Today" value={a?.blockedBrowsing.today} icon={<ShieldAlert className="h-4 w-4" />} accent />
          <Stat label="Last 7d" value={a?.blockedBrowsing.last7d} />
          <Stat label="Last 30d" value={a?.blockedBrowsing.last30d} />
          {(a?.blockedBrowsing.byReason ?? []).slice(0, 3).map((r) => (
            <Stat key={r.reason} label={r.reason} value={r.count} />
          ))}
        </StatGrid>
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

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="font-display text-lg font-bold flex items-center gap-2 mb-3">
        {icon} {title}
      </h2>
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
