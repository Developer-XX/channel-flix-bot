import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { Film, LayoutDashboard, MessageSquare, ArrowLeft, Send, AlertTriangle, Zap } from "lucide-react";
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
  const q = useQuery({ queryKey: ["admin-gate"], queryFn: () => gate(), retry: false });

  if (q.isLoading) {
    return <div className="p-8 text-sm text-muted-foreground">Checking admin access…</div>;
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
        </nav>
        <div className="mt-auto p-4 text-xs text-muted-foreground">
          <Link to="/" className="hover:text-foreground inline-flex items-center gap-1"><ArrowLeft className="h-3 w-3" /> Back to site</Link>
        </div>
      </aside>
      <main className="flex-1 min-w-0">
        <div className="md:hidden flex items-center justify-between px-4 h-14 border-b border-border bg-sidebar">
          <Link to="/admin" className="font-bold">StreamVault Admin</Link>
          <Link to="/"><Button size="sm" variant="ghost">Site</Button></Link>
        </div>
        <Outlet />
      </main>
    </div>
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
