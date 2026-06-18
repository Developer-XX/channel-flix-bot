import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Film, Users, MessageSquare, Download, Activity, Clock, AlertOctagon, BarChart3 } from "lucide-react";
import { getAdminStats } from "@/lib/admin.functions";
import { getCronMetrics } from "@/lib/cron-metrics.functions";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: Dashboard,
});

function Dashboard() {
  const stats = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => getAdminStats(),
  });
  const cron = useQuery({
    queryKey: ["admin-cron-metrics"],
    queryFn: () => getCronMetrics(),
    refetchInterval: 60_000,
  });

  return (
    <div className="p-6 md:p-10 max-w-6xl">
      <h1 className="font-display text-3xl font-bold">Dashboard</h1>
      <p className="mt-1 text-muted-foreground">Overview of your platform.</p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-8">
        <StatCard icon={<Film className="h-5 w-5" />} label="Titles" value={stats.data?.titles} accent />
        <StatCard icon={<MessageSquare className="h-5 w-5" />} label="Pending requests" value={stats.data?.requests} />
        <StatCard icon={<Download className="h-5 w-5" />} label="Media files" value={stats.data?.files} />
        <StatCard icon={<Users className="h-5 w-5" />} label="Downloads" value={stats.data?.downloads} />
      </div>

      <section className="mt-10 rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-display text-lg font-bold flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" /> Index rebuild cron · last 24h
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              pg_cron hits <code>/api/public/hooks/maybe-rebuild-indexes</code> every 10 minutes.
            </p>
          </div>
          {cron.data?.lastRunAt && (
            <div className="text-xs text-muted-foreground">
              Last run {new Date(cron.data.lastRunAt).toLocaleTimeString()}
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
          <CronStat label="Runs" value={cron.data?.total ?? "—"} hint={cron.data ? `${cron.data.runsPerHour}/hr` : undefined} />
          <CronStat label="Successful" value={cron.data?.successful ?? "—"} tone="ok" />
          <CronStat
            label="Overlap skips"
            value={cron.data?.overlapSkips ?? "—"}
            tone={(cron.data?.overlapSkips ?? 0) > 0 ? "warn" : undefined}
            icon={<Clock className="h-3.5 w-3.5" />}
          />
          <CronStat label="No-pending skips" value={cron.data?.noPendingSkips ?? "—"} />
          <CronStat label="Avg duration" value={cron.data ? formatMs(cron.data.avgDurationMs) : "—"} />
        </div>
        {(cron.data?.errors ?? 0) > 0 && (
          <div className="mt-3 flex items-center gap-2 text-xs text-red-400">
            <AlertOctagon className="h-3.5 w-3.5" /> {cron.data?.errors} errored run(s) in the window.
          </div>
        )}
      </section>


      <div className="mt-10 grid gap-4 md:grid-cols-2">
        <Link to="/admin/titles" className="rounded-2xl border border-border bg-card p-6 hover:border-ring transition-colors">
          <Film className="h-6 w-6 text-primary" />
          <h2 className="mt-3 font-display text-xl font-bold">Manage titles</h2>
          <p className="mt-1 text-sm text-muted-foreground">Create movies, series, anime and more — auto-enriched from TMDB.</p>
        </Link>
        <Link to="/admin/requests" className="rounded-2xl border border-border bg-card p-6 hover:border-ring transition-colors">
          <MessageSquare className="h-6 w-6 text-accent" />
          <h2 className="mt-3 font-display text-xl font-bold">Review requests</h2>
          <p className="mt-1 text-sm text-muted-foreground">Approve or reject what your users are asking for.</p>
        </Link>
      </div>

      <div className="mt-10 rounded-2xl border border-dashed border-border p-6 bg-surface/30">
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">Phase 2 coming up:</span> Telegram bot, channel sync, episode auto-detection (S01E01 patterns),
          token verification, link shorteners (Nanolinks / Adrinolinks), and broadcast tools.
        </p>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: number | undefined; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border border-border p-5 ${accent ? "bg-gradient-to-br from-primary/15 to-accent/10" : "bg-card"}`}>
      <div className="flex items-center justify-between text-muted-foreground">
        {icon}
        <span className="text-xs uppercase tracking-wider">{label}</span>
      </div>
      <div className="mt-3 font-display text-3xl font-bold">{value ?? "—"}</div>
    </div>
  );
}

function CronStat({
  label,
  value,
  hint,
  tone,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "ok" | "warn";
  icon?: React.ReactNode;
}) {
  const color = tone === "ok" ? "text-emerald-500" : tone === "warn" ? "text-amber-500" : "";
  return (
    <div className="rounded-lg border border-border bg-surface/40 p-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={`mt-1 font-display text-xl font-semibold ${color}`}>{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function formatMs(ms: number): string {
  if (!ms || ms < 0) return "—";
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}
