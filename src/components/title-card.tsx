import { Link } from "@tanstack/react-router";
import { Star, PlayCircle } from "lucide-react";
import { CATEGORY_LABEL, type CategorySlug } from "@/lib/categories";

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
  return (
    <Link
      to="/title/$slug"
      params={{ slug: item.slug }}
      className="group relative block overflow-hidden rounded-xl bg-surface shadow-card transition-all duration-300 hover:scale-[1.04] hover:z-10 hover:shadow-[0_20px_50px_-12px_oklch(0.62_0.24_18/0.4)]"
    >
      <div className="aspect-[2/3] w-full bg-muted relative">
        {item.poster_url ? (
          <img
            src={item.poster_url}
            alt={`${item.title} poster`}
            loading="lazy"
            className="h-full w-full object-cover transition-opacity duration-300 group-hover:opacity-90"
          />
        ) : (
          <div className="h-full w-full grid place-items-center text-muted-foreground text-xs">
            No poster
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-card opacity-90" />
        <div className="absolute top-2 left-2 rounded-md bg-background/70 backdrop-blur px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-foreground">
          {CATEGORY_LABEL[item.category]}
        </div>
        {item.rating != null && item.rating > 0 && (
          <div className="absolute top-2 right-2 flex items-center gap-1 rounded-md bg-background/70 backdrop-blur px-1.5 py-0.5 text-xs">
            <Star className="h-3 w-3 fill-gold text-gold" />
            <span className="font-medium">{item.rating.toFixed(1)}</span>
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 p-3 space-y-1">
          <h3 className="font-semibold text-sm leading-tight line-clamp-2">{item.title}</h3>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{item.release_year ?? "—"}</span>
            <PlayCircle className="h-4 w-4 text-primary opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>
      </div>
    </Link>
  );
}

export function TitleCardSkeleton() {
  return (
    <div className="aspect-[2/3] rounded-xl bg-surface animate-pulse" />
  );
}
