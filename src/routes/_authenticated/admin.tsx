import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { Film, LayoutDashboard, MessageSquare, ArrowLeft, Send, AlertTriangle, Zap, ShieldAlert, Activity, Stethoscope, Settings as SettingsIcon, PlayCircle, Crown, MessageCircle, Megaphone, Bell, Users, Images, BadgeDollarSign, ScrollText, Link2 } from "lucide-react";
import { useQuery as useReactQuery } from "@tanstack/react-query";
import { listAdminAlerts } from "@/lib/admin-alerts.functions";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { getAdminGate, claimFirstAdmin } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminGateLayout,
  errorComponent: ({ error }) => (
    <div className="p-8 max-w-xl mx-auto">
      <h1 className="text-xl font-bold mb-2">Admin loading failed</h1>
      <pre className="text-xs bg-muted p-3 rounded overflow-auto">{error.message}</pre>
      <Link to="/" className="text-primary text-sm mt-3 inline-block">← Back to site</Link>
    </div>
  ),
});

function AdminGateLayout() {
  const gate = useServerFn(getAdminGate);
  const claim = useServerFn(claimFirstAdmin);
  const q = useQuery({
    queryKey: ["admin-gate"],
    queryFn: () => gate(),
    // Transient 401s can happen on the very first call if the bearer token
    // hasn't been attached yet (session still hydrating). Retry a couple of
    // times with backoff before showing the error UI.
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 3000),
    // Keep the gate cached across admin sub-route navigation so we don't
    // flash "Verifying admin access…" each time the user clicks a section.
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  if (q.isLoading) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-md" />
          <Skeleton className="h-6 w-48" />
        </div>
        <p className="text-xs text-muted-foreground">Verifying admin access…</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      </div>
    );
  }
  if (q.error) {
    return (
      <div className="p-8 max-w-xl mx-auto space-y-3">
        <h1 className="text-xl font-bold">Could not verify admin access</h1>
        <pre className="text-xs bg-muted p-3 rounded overflow-auto">{(q.error as Error).message}</pre>
        <Button variant="outline" onClick={() => q.refetch()}>Retry</Button>
        <Link to="/" className="text-primary text-sm inline-block">← Back to site</Link>
      </div>
    );
  }
  const g = q.data!;
  if (!g.canAccessAdmin) {
    return (
      <div className="p-8 max-w-xl mx-auto space-y-4">
        <div className="flex items-center gap-2 text-amber-500">
          <AlertTriangle className="h-5 w-5" />
          <h1 className="text-xl font-bold">Admin access required</h1>
        </div>
        <div className="rounded-md border border-border p-4 text-sm space-y-1">
          <div><span className="text-muted-foreground">Signed in as:</span> {g.email ?? "(no email)"}</div>
          <div className="font-mono text-xs text-muted-foreground break-all">{g.userId}</div>
          <div className="pt-1">
            <span className="text-muted-foreground">Roles:</span>{" "}
            {g.isAdmin ? "admin " : ""}{g.isModerator ? "moderator " : ""}
            {!g.isAdmin && !g.isModerator && <span className="text-muted-foreground">none</span>}
          </div>
          <div><span className="text-muted-foreground">Any admin exists:</span> {g.hasAnyAdmin ? "yes" : "no"}</div>
        </div>
        {!g.hasAnyAdmin && (
          <div className="space-y-2">
            <p className="text-sm">No admin exists yet. You can claim the first admin role:</p>
            <Button
              onClick={async () => {
                try {
                  await claim();
                  toast.success("You are now admin");
                  q.refetch();
                } catch (e: any) {
                  toast.error(e?.message ?? "Claim failed");
                }
              }}
            >
              Claim first admin
            </Button>
          </div>
        )}
        <Link to="/" className="text-primary text-sm inline-block">← Back to site</Link>
      </div>
    );
  }
  return <AdminLayout />;
}

function AdminLayout() {
  return (
    <div className="min-h-screen flex">
      <aside className="hidden md:flex flex-col w-60 shrink-0 border-r border-border bg-sidebar">
        <Link to="/" className="flex items-center gap-2 px-5 h-16 border-b border-border font-display font-bold">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-primary">
            <Film className="h-4 w-4 text-primary-foreground" />
          </span>
          StreamVault
        </Link>
        <nav className="p-3 space-y-1 text-sm">
          <NavItem to="/admin" icon={<LayoutDashboard className="h-4 w-4" />} label="Dashboard" exact />
          <NavItem to="/admin/titles" icon={<Film className="h-4 w-4" />} label="Titles" />
          <NavItem to="/admin/requests" icon={<MessageSquare className="h-4 w-4" />} label="Requests" />
          <NavItem to="/admin/telegram" icon={<Send className="h-4 w-4" />} label="Telegram" />
          <NavItem to="/admin/bulk" icon={<Zap className="h-4 w-4" />} label="Bulk rematch" />
          <NavItem to="/admin/episode-audit" icon={<Stethoscope className="h-4 w-4" />} label="Episode audit" />
          <NavItem to="/admin/verification-limits" icon={<ShieldAlert className="h-4 w-4" />} label="Verification limits" />
          <NavItem to="/admin/sync-trace" icon={<Activity className="h-4 w-4" />} label="Sync trace" />
          <NavItem to="/admin/diagnostics" icon={<Stethoscope className="h-4 w-4" />} label="Diagnostics" />
          <NavItem to="/admin/health" icon={<Activity className="h-4 w-4" />} label="Health check" />
          <NavItem to="/admin/error-log" icon={<AlertTriangle className="h-4 w-4" />} label="Error log" />
          <NavItem to="/admin/alerts" icon={<Bell className="h-4 w-4" />} label="Alerts & cron" />
          <NavItem to="/admin/audit" icon={<ScrollText className="h-4 w-4" />} label="Audit log" />
          <NavItem to="/admin/shorteners" icon={<Link2 className="h-4 w-4" />} label="Shorteners" />
          <NavItem to="/admin/tutorial" icon={<PlayCircle className="h-4 w-4" />} label="Tutorial video" />
          <NavItem to="/admin/premium" icon={<Crown className="h-4 w-4" />} label="Premium" />
          <NavItem to="/admin/users" icon={<Users className="h-4 w-4" />} label="Users & Broadcast" />
          <NavItem to="/admin/support" icon={<MessageCircle className="h-4 w-4" />} label="Support chat" />
          <NavItem to="/admin/announcements" icon={<Megaphone className="h-4 w-4" />} label="Announcements" />
          <NavItem to="/admin/slideshow" icon={<Images className="h-4 w-4" />} label="Homepage slideshow" />
          <NavItem to="/admin/ads" icon={<BadgeDollarSign className="h-4 w-4" />} label="Ads" />
          <NavItem to="/admin/notifications" icon={<Bell className="h-4 w-4" />} label="Notifications" />
          <NavItem to="/admin/settings" icon={<SettingsIcon className="h-4 w-4" />} label="Settings" />
        </nav>
        <div className="mt-auto p-4 text-xs text-muted-foreground">
          <Link to="/" className="hover:text-foreground inline-flex items-center gap-1"><ArrowLeft className="h-3 w-3" /> Back to site</Link>
        </div>
      </aside>
      <main className="flex-1 min-w-0">
        <div className="md:hidden sticky top-0 z-20 border-b border-border bg-sidebar/95 backdrop-blur">
          <div className="flex items-center justify-between px-3 h-12">
            <Link to="/admin" className="font-bold text-sm truncate">StreamVault Admin</Link>
            <Link to="/"><Button size="sm" variant="ghost">Site</Button></Link>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-3 pb-2 text-xs no-scrollbar">
            <MobileNavItem to="/admin" label="Dashboard" exact />
            <MobileNavItem to="/admin/titles" label="Titles" />
            <MobileNavItem to="/admin/requests" label="Requests" />
            <MobileNavItem to="/admin/telegram" label="Telegram" />
            <MobileNavItem to="/admin/bulk" label="Bulk" />
            <MobileNavItem to="/admin/episode-audit" label="Episode audit" />
            <MobileNavItem to="/admin/verification-limits" label="Limits" />
            <MobileNavItem to="/admin/sync-trace" label="Sync trace" />
            <MobileNavItem to="/admin/diagnostics" label="Diagnostics" />
            <MobileNavItem to="/admin/health" label="Health" />
            <MobileNavItem to="/admin/error-log" label="Errors" />
            <MobileNavItem to="/admin/alerts" label="Alerts" />
            <MobileNavItem to="/admin/audit" label="Audit" />
            <MobileNavItem to="/admin/shorteners" label="Shorteners" />
            <MobileNavItem to="/admin/tutorial" label="Tutorial" />
            <MobileNavItem to="/admin/premium" label="Premium" />
            <MobileNavItem to="/admin/users" label="Users" />
            <MobileNavItem to="/admin/support" label="Support" />
            <MobileNavItem to="/admin/announcements" label="Announce" />
            <MobileNavItem to="/admin/slideshow" label="Slides" />
            <MobileNavItem to="/admin/ads" label="Ads" />
            <MobileNavItem to="/admin/notifications" label="Alerts" />
            <MobileNavItem to="/admin/settings" label="Settings" />
          </nav>
        </div>
        <AlertsBanner />
        <Outlet />
      </main>
    </div>
  );
}

function AlertsBanner() {
  const fn = useServerFn(listAdminAlerts);
  const q = useReactQuery({ queryKey: ["admin-alerts-banner"], queryFn: () => fn(), refetchInterval: 30_000, retry: 1 });
  if (!q.data || (!q.data.hasErrors && !q.data.cron.some((c: any) => c.isLagging))) return null;
  const errorCount = q.data.open.filter((a: any) => a.severity === "error").length;
  const lagging = q.data.cron.filter((c: any) => c.isLagging).map((c: any) => c.job_name);
  return (
    <Link to="/admin/alerts" className="block bg-destructive/10 border-b border-destructive/30 text-destructive text-sm px-4 py-2 hover:bg-destructive/15">
      <span className="font-medium">⚠ {errorCount > 0 ? `${errorCount} active alert${errorCount === 1 ? "" : "s"}` : "Cron lag detected"}</span>
      {lagging.length > 0 && <span className="ml-2 text-xs opacity-80">Lagging: {lagging.join(", ")}</span>}
      <span className="ml-2 text-xs underline">View →</span>
    </Link>
  );
}

function MobileNavItem({ to, label, exact }: { to: string; label: string; exact?: boolean }) {
  return (
    <Link
      to={to as never}
      activeOptions={{ exact: !!exact }}
      activeProps={{ className: "bg-sidebar-accent text-sidebar-accent-foreground border-sidebar-accent" }}
      className="shrink-0 rounded-md border border-border px-2.5 py-1 text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors whitespace-nowrap"
    >
      {label}
    </Link>
  );
}

function NavItem({ to, icon, label, exact }: { to: string; icon: React.ReactNode; label: string; exact?: boolean }) {
  return (
    <Link
      to={to as never}
      activeOptions={{ exact: !!exact }}
      activeProps={{ className: "bg-sidebar-accent text-sidebar-accent-foreground" }}
      className="flex items-center gap-3 rounded-md px-3 py-2 text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
    >
      {icon}
      {label}
    </Link>
  );
}
