import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Search, Menu, X, Film, Shield, User as UserIcon, LogOut, MessageCircle, Crown } from "lucide-react";
import { useEffect, useState } from "react";
import { CATEGORIES } from "@/lib/categories";
import { useAuth, useIsAdmin } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { AnnouncementBar } from "@/components/AnnouncementBar";

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
          : "bg-gradient-to-b from-background/90 via-background/60 to-transparent"
      }`}
    >
      <AnnouncementBar />
      <div className="mx-auto flex h-14 sm:h-16 max-w-7xl items-center gap-2 sm:gap-3 px-3 sm:px-4 md:px-6 min-w-0">
        <Link
          to="/"
          className="flex items-center gap-2 font-display font-bold tracking-tight shrink-0"
        >
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-primary glow-primary">
            <Film className="h-4 w-4 text-primary-foreground" />
          </span>
          <span className="text-base sm:text-lg">
            Stream<span className="text-gradient-primary">Vault</span>
          </span>
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
              className="h-9 w-40 lg:w-56 rounded-full bg-surface/80 pl-9 pr-3 text-sm outline-none border border-border focus:border-ring focus:ring-2 focus:ring-ring/40 transition"
            />
          </div>
        </form>

        <div className="ml-auto md:ml-2 flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Mobile search icon */}
          <button
            type="button"
            onClick={() => navigate({ to: "/search", search: { q: "" } })}
            className="md:hidden grid h-9 w-9 place-items-center rounded-full text-foreground hover:bg-surface"
            aria-label="Search"
          >
            <Search className="h-4 w-4" />
          </button>

          {isAdmin && (
            <Link to="/admin" aria-label="Admin panel">
              <Button variant="outline" size="sm" className="hidden sm:inline-flex">
                <Shield className="h-4 w-4 sm:mr-1.5" />
                <span className="hidden sm:inline">Admin</span>
              </Button>
              <span className="sm:hidden grid h-9 w-9 place-items-center rounded-full border border-border text-foreground hover:bg-surface">
                <Shield className="h-4 w-4" />
              </span>
            </Link>
          )}

          {user ? (
            <>
              <Link to="/premium" aria-label="Premium" className="hidden md:block">
                <Button variant="ghost" size="sm">
                  <Crown className="h-4 w-4 mr-1.5 text-amber-400" />
                  Premium
                </Button>
              </Link>
              <Link to="/support" aria-label="Support" className="hidden md:block">
                <Button variant="ghost" size="sm">
                  <MessageCircle className="h-4 w-4 mr-1.5" />
                  Help
                </Button>
              </Link>
              <Link to="/account" aria-label="Account" className="hidden sm:block">
                <Button variant="ghost" size="sm">
                  <UserIcon className="h-4 w-4 mr-1.5" />
                  Account
                </Button>
              </Link>
              <Button
                size="sm"
                variant="ghost"
                className="hidden sm:inline-flex"
                onClick={async () => {
                  await supabase.auth.signOut();
                  navigate({ to: "/" });
                }}
              >
                <LogOut className="h-4 w-4 mr-1.5" />
                Sign out
              </Button>
            </>
          ) : (
            <Link to="/auth">
              <Button
                size="sm"
                className="bg-gradient-primary hover:opacity-90 text-primary-foreground border-0 h-9 px-3 sm:px-4"
              >
                Sign in
              </Button>
            </Link>
          )}

          <button
            onClick={() => setMobileOpen((v) => !v)}
            className="xl:hidden grid h-9 w-9 place-items-center rounded-full text-foreground hover:bg-surface border border-transparent hover:border-border"
            aria-label="Toggle menu"
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="xl:hidden border-t border-border bg-background/95 backdrop-blur-xl">
          <div className="mx-auto max-w-7xl px-4 py-4 space-y-1">
            <form onSubmit={submit} className="mb-3 md:hidden">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search titles…"
                  className="h-11 w-full rounded-full bg-surface pl-10 pr-3 text-sm outline-none border border-border focus:border-ring"
                />
              </div>
            </form>
            <div className="grid grid-cols-2 gap-1.5">
              {CATEGORIES.map((c) => (
                <Link
                  key={c.slug}
                  to="/browse/$category"
                  params={{ category: c.slug }}
                  className="rounded-lg bg-surface/60 px-3 py-3 text-sm font-medium text-foreground hover:bg-surface transition-colors"
                >
                  {c.label}
                </Link>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t border-border space-y-1">
              {isAdmin && (
                <Link
                  to="/admin"
                  className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-foreground hover:bg-surface"
                >
                  <Shield className="h-4 w-4" /> Admin panel
                </Link>
              )}
              {user && (
                <>
                  <Link
                    to="/premium"
                    className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-foreground hover:bg-surface"
                  >
                    <Crown className="h-4 w-4 text-amber-400" /> Premium
                  </Link>
                  <Link
                    to="/support"
                    className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-foreground hover:bg-surface"
                  >
                    <MessageCircle className="h-4 w-4" /> Help & Support
                  </Link>
                  <Link
                    to="/account"
                    className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-foreground hover:bg-surface"
                  >
                    <UserIcon className="h-4 w-4" /> Account
                  </Link>
                  <button
                    type="button"
                    onClick={async () => {
                      await supabase.auth.signOut();
                      navigate({ to: "/" });
                    }}
                    className="w-full flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-foreground hover:bg-surface text-left"
                  >
                    <LogOut className="h-4 w-4" /> Sign out
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
