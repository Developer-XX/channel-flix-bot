import { Link, useNavigate } from "@tanstack/react-router";
import { Star, PlayCircle } from "lucide-react";
import { CATEGORY_LABEL, type CategorySlug } from "@/lib/categories";
import { useIsAuthed } from "@/hooks/use-session-flag";

export interface TitleCardData {
  id: string;
  slug: string;
  title: string;
  poster_url: string | null;
  release_year: number | null;
  rating: number | null;
  category: CategorySlug;
}

export function TitleCard({ item }: { item: TitleCardData }) {
  const isAuthed = useIsAuthed();
  const navigate = useNavigate();

  const cardClass =
    "group relative block overflow-hidden rounded-lg sm:rounded-xl bg-surface shadow-card transition-all duration-300 active:scale-[0.98] md:hover:scale-[1.04] md:hover:z-10 md:hover:shadow-[0_20px_50px_-12px_oklch(0.62_0.24_18/0.4)] ring-1 ring-border/40 hover:ring-primary/40";

  const inner = (
    <div className="aspect-[2/3] w-full bg-muted relative">
      {item.poster_url ? (
        <img
          src={item.poster_url}
          alt={`${item.title} poster`}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition-opacity duration-300 group-hover:opacity-90"
        />
      ) : (
        <div className="h-full w-full grid place-items-center text-muted-foreground text-xs">
          No poster
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-card opacity-90" />
      <div className="absolute top-1.5 left-1.5 sm:top-2 sm:left-2 rounded-md bg-background/70 backdrop-blur px-1.5 sm:px-2 py-0.5 text-[9px] sm:text-[10px] font-medium uppercase tracking-wider text-foreground">
        {CATEGORY_LABEL[item.category]}
      </div>
      {item.rating != null && item.rating > 0 && (
        <div className="absolute top-1.5 right-1.5 sm:top-2 sm:right-2 flex items-center gap-1 rounded-md bg-background/70 backdrop-blur px-1.5 py-0.5 text-[10px] sm:text-xs">
          <Star className="h-3 w-3 fill-gold text-gold" />
          <span className="font-medium">{item.rating.toFixed(1)}</span>
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 p-2 sm:p-3 space-y-0.5 sm:space-y-1">
        <h3 className="font-semibold text-xs sm:text-sm leading-tight line-clamp-2">{item.title}</h3>
        <div className="flex items-center justify-between text-[10px] sm:text-xs text-muted-foreground">
          <span>{item.release_year ?? "—"}</span>
          <PlayCircle className="h-4 w-4 text-primary opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>
    </div>
  );

  // Anonymous visitors: render a button-styled card that bounces to /auth
  // with a redirect back to the title page after they sign in.
  if (!isAuthed) {
    return (
      <button
        type="button"
        aria-label={`Sign in to view ${item.title}`}
        onClick={() =>
          navigate({
            to: "/auth",
            search: { redirect: `/title/${item.slug}` } as never,
          })
        }
        className={`${cardClass} text-left w-full`}
      >
        {inner}
      </button>
    );
  }

  return (
    <Link to="/title/$slug" params={{ slug: item.slug }} className={cardClass}>
      {inner}
    </Link>
  );
}

export function TitleCardSkeleton() {
  return (
    <div className="aspect-[2/3] rounded-xl bg-surface animate-pulse" />
  );
}
