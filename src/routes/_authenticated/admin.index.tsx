import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Film, Users, MessageSquare, Download } from "lucide-react";
import { getAdminStats } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: Dashboard,
});

function Dashboard() {
  const stats = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => getAdminStats(),
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
