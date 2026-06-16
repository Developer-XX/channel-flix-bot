import { Link } from "@tanstack/react-router";
import { Film } from "lucide-react";
import { CATEGORIES } from "@/lib/categories";

export function SiteFooter() {
  return (
    <footer className="border-t border-border/60 bg-surface/40 mt-24">
      <div className="mx-auto max-w-7xl px-6 py-12 grid gap-10 md:grid-cols-4">
        <div className="md:col-span-1">
          <Link to="/" className="flex items-center gap-2 font-display text-lg font-bold">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-primary">
              <Film className="h-4 w-4 text-primary-foreground" />
            </span>
            StreamVault
          </Link>
          <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
            Discover movies, web series, anime, K-Drama and more — all in one premium directory.
          </p>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-foreground mb-3">Browse</h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            {CATEGORIES.map((c) => (
              <li key={c.slug}>
                <Link to="/browse/$category" params={{ category: c.slug }} className="hover:text-foreground transition-colors">
                  {c.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-foreground mb-3">Platform</h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li><Link to="/search" search={{ q: "" }} className="hover:text-foreground">Search</Link></li>
            <li><Link to="/request" className="hover:text-foreground">Request content</Link></li>
            <li><Link to="/account" className="hover:text-foreground">Account</Link></li>
          </ul>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-foreground mb-3">Legal</h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>StreamVault does not host any files.</li>
            <li>All media is sourced via Telegram channels.</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-border/60 py-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} StreamVault. Built for content lovers.
      </div>
    </footer>
  );
}
