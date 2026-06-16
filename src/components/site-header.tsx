import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Search, Menu, X, Film } from "lucide-react";
import { useEffect, useState } from "react";
import { CATEGORIES } from "@/lib/categories";
import { useAuth, useIsAdmin } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isAdmin } = useIsAdmin();
  const { location } = useRouterState();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => setMobileOpen(false), [location.pathname]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    navigate({ to: "/search", search: { q: term } });
  };

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled || mobileOpen
          ? "glass border-b border-border/60"
          : "bg-gradient-to-b from-background/90 to-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 md:px-6 min-w-0">
        <Link to="/" className="flex items-center gap-2 font-display text-lg font-bold tracking-tight shrink-0">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-primary glow-primary">
            <Film className="h-4 w-4 text-primary-foreground" />
          </span>
          <span className="hidden sm:inline">StreamVault</span>
        </Link>

        <nav className="hidden xl:flex items-center gap-1 text-sm min-w-0">
          {CATEGORIES.map((c) => (
            <Link
              key={c.slug}
              to="/browse/$category"
              params={{ category: c.slug }}
              className="px-3 py-2 rounded-md text-muted-foreground transition-colors hover:text-foreground hover:bg-surface whitespace-nowrap"
              activeProps={{ className: "text-foreground bg-surface" }}
            >
              {c.label}
            </Link>
          ))}
        </nav>

        <form onSubmit={submit} className="ml-auto hidden md:flex items-center min-w-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search titles…"
              className="h-9 w-40 lg:w-56 rounded-md bg-surface pl-9 pr-3 text-sm outline-none border border-border focus:border-ring focus:ring-2 focus:ring-ring/40 transition"
            />
          </div>
        </form>


        <div className="ml-auto md:ml-2 flex items-center gap-2 shrink-0">
          {isAdmin && (
            <Link to="/admin" className="hidden sm:block">
              <Button variant="outline" size="sm">Admin</Button>
            </Link>
          )}
          {user ? (
            <>
              <Link to="/account" className="hidden sm:block">
                <Button variant="ghost" size="sm">Account</Button>
              </Link>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  await supabase.auth.signOut();
                  navigate({ to: "/" });
                }}
              >
                Sign out
              </Button>
            </>
          ) : (
            <Link to="/auth">
              <Button size="sm" className="bg-gradient-primary hover:opacity-90 text-primary-foreground border-0">
                Sign in
              </Button>
            </Link>
          )}
          <button
            onClick={() => setMobileOpen((v) => !v)}
            className="lg:hidden grid h-9 w-9 place-items-center rounded-md text-foreground hover:bg-surface"
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="lg:hidden border-t border-border bg-background/95 backdrop-blur-md">
          <div className="mx-auto max-w-7xl px-4 py-4 space-y-1">
            <form onSubmit={submit} className="mb-3 md:hidden">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search titles…"
                  className="h-10 w-full rounded-md bg-surface pl-9 pr-3 text-sm outline-none border border-border"
                />
              </div>
            </form>
            {CATEGORIES.map((c) => (
              <Link
                key={c.slug}
                to="/browse/$category"
                params={{ category: c.slug }}
                className="block rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-surface hover:text-foreground"
              >
                {c.label}
              </Link>
            ))}
            {isAdmin && (
              <Link to="/admin" className="block rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-surface hover:text-foreground">
                Admin panel
              </Link>
            )}
            {user && (
              <Link to="/account" className="block rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-surface hover:text-foreground">
                Account
              </Link>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
