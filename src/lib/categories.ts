export type CategorySlug =
  | "movie"
  | "series"
  | "anime"
  | "cartoon"
  | "kdrama"
  | "documentary";

export const CATEGORIES: { slug: CategorySlug; label: string; href: string }[] = [
  { slug: "movie", label: "Movies", href: "/browse/movie" },
  { slug: "series", label: "Web Series", href: "/browse/series" },
  { slug: "anime", label: "Anime", href: "/browse/anime" },
  { slug: "cartoon", label: "Cartoons", href: "/browse/cartoon" },
  { slug: "kdrama", label: "K-Drama", href: "/browse/kdrama" },
  { slug: "documentary", label: "Documentaries", href: "/browse/documentary" },
];

export const CATEGORY_LABEL: Record<CategorySlug, string> = {
  movie: "Movies",
  series: "Web Series",
  anime: "Anime",
  cartoon: "Cartoons",
  kdrama: "K-Drama",
  documentary: "Documentaries",
};

export function isCategory(value: string): value is CategorySlug {
  return value in CATEGORY_LABEL;
}
