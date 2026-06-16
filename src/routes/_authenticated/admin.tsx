import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router";
import { Film, LayoutDashboard, MessageSquare, ArrowLeft, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAdminGate } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: async () => {
    const gate = await getAdminGate();
    if (!gate.canAccessAdmin) throw redirect({ to: "/" });
    return gate;
  },
  component: AdminLayout,
});

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
