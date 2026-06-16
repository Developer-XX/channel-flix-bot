import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Film, LayoutDashboard, MessageSquare, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { claimFirstAdmin, getAdminGate } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminLayout,
});

function AdminLayout() {
  const [checked, setChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [hasAnyAdmin, setHasAnyAdmin] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const gate = await getAdminGate();
        setIsAdmin(gate.canAccessAdmin);
        setHasAnyAdmin(gate.hasAnyAdmin);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Admin check failed");
      } finally {
        setChecked(true);
      }
    })();
  }, []);

  const claimAdmin = async () => {
    try {
      await claimFirstAdmin();
      toast.success("You are now the admin.");
      setIsAdmin(true);
      setHasAnyAdmin(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to claim admin role");
    }
  };

  if (!checked) {
    return <div className="min-h-screen grid place-items-center text-muted-foreground">Loading…</div>;
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen grid place-items-center px-4">
        <div className="max-w-md text-center rounded-2xl border border-border bg-card p-8">
          <h1 className="font-display text-2xl font-bold">Admin access required</h1>
          {!hasAnyAdmin ? (
            <>
              <p className="mt-2 text-muted-foreground">
                No admin has been set up yet. Since you're the first user here, you can claim admin.
              </p>
              <Button onClick={claimAdmin} className="mt-6 bg-gradient-primary text-primary-foreground border-0">
                Claim admin role
              </Button>
            </>
          ) : (
            <>
              <p className="mt-2 text-muted-foreground">
                Your account doesn't have admin or moderator role. Contact the platform owner to be granted access.
              </p>
              <Link to="/" className="mt-6 inline-block">
                <Button variant="outline"><ArrowLeft className="h-4 w-4 mr-1.5" />Back home</Button>
              </Link>
            </>
          )}
        </div>
      </div>
    );
  }

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
