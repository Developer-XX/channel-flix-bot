import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Hero } from "@/components/hero";
import { HomeSlideshow } from "@/components/HomeSlideshow";
import { TitleRow } from "@/components/title-row";
import type { TitleCardData } from "@/components/title-card";
import { CATEGORIES } from "@/lib/categories";
import { getHomepageLayout, DEFAULT_SECTION_ORDER } from "@/lib/homepage.functions";
import { AdSlot } from "@/components/AdSlot";



export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "StreamVault — Movies, Series, Anime, K-Drama & more" },
      {
        name: "description",
        content:
          "Browse thousands of movies, web series, anime, K-Drama, cartoons and documentaries. Curated downloads delivered through Telegram.",
      },
      { property: "og:title", content: "StreamVault — Your premium media vault" },
      { property: "og:description", content: "Movies, series, anime, K-Drama and more. One vault. Built for content lovers." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "/" },
    ],
    links: [{ rel: "canonical", href: "/" }],
  }),
  component: HomePage,
});

const card = "id, slug, title, poster_url, release_year, rating, category";

function HomePage() {
  const layoutFn = useServerFn(getHomepageLayout);
  const layout = useQuery({ queryKey: ["homepage-layout"], queryFn: () => layoutFn(), retry: false });

  const featured = useQuery({
    queryKey: ["featured"],
    queryFn: async () => {
      const { data } = await supabase
        .from("master_titles")
        .select("slug, title, overview, backdrop_url")
        .eq("status", "published")
        .eq("is_featured", true)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  const trending = useQuery({
    queryKey: ["trending"],
    queryFn: async () => {
      const { data } = await supabase
        .from("master_titles")
        .select(card)
        .eq("status", "published")
        .eq("is_trending", true)
        .order("view_count", { ascending: false })
        .limit(12);
      return (data ?? []) as TitleCardData[];
    },
  });

  const latest = useQuery({
    queryKey: ["latest"],
    queryFn: async () => {
      const { data } = await supabase
        .from("master_titles")
        .select(card)
        .eq("status", "published")
        .order("created_at", { ascending: false })
        .limit(12);
      return (data ?? []) as TitleCardData[];
    },
  });

  const byCategory = (cat: string) =>
    useQuery({
      queryKey: ["by-cat", cat],
      queryFn: async () => {
        const { data } = await supabase
          .from("master_titles")
          .select(card)
          .eq("status", "published")
          .eq("category", cat as never)
          .order("created_at", { ascending: false })
          .limit(12);
        return (data ?? []) as TitleCardData[];
      },
    });

  /* eslint-disable react-hooks/rules-of-hooks */
  const movies = byCategory("movie");
  const series = byCategory("series");
  const anime = byCategory("anime");
  const kdrama = byCategory("kdrama");

  const totalCount = (trending.data?.length ?? 0) + (latest.data?.length ?? 0);
  const empty = !trending.isLoading && !latest.isLoading && totalCount === 0;

  const sections: Record<string, { title: string; q: typeof trending; hint?: string; href?: string }> = {
    trending: { title: "Trending now", q: trending, hint: "No trending titles yet.", href: "/section/trending" },
    latest: { title: "Latest additions", q: latest, hint: "Nothing added yet.", href: "/section/latest" },
    movies: { title: "Movies", q: movies, href: "/browse/movie" },
    series: { title: "Web Series", q: series, href: "/browse/series" },
    anime: { title: "Anime", q: anime, href: "/browse/anime" },
    kdrama: { title: "K-Drama", q: kdrama, href: "/browse/kdrama" },
  };
  const order = (layout.data?.sectionOrder?.length ? layout.data.sectionOrder : [...DEFAULT_SECTION_ORDER]).filter(
    (k) => sections[k],
  );

  const slides = layout.data?.slideshowEnabled ? (layout.data?.slides ?? []) : [];

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1">
        {slides.length > 0 ? <HomeSlideshow slides={slides} /> : <Hero featured={featured.data} />}

        {empty && (
          <section className="mx-auto max-w-3xl px-6 py-16 text-center">
            <h2 className="font-display text-2xl font-bold">Your vault is empty</h2>
            <p className="mt-3 text-muted-foreground">
              No titles have been published yet. If you're an admin, head to the panel to add your first movie or series — TMDB will fill in the details automatically.
            </p>
            <div className="mt-6 flex justify-center gap-3">
              <Link to="/admin" className="rounded-md bg-gradient-primary text-primary-foreground px-5 py-2.5 text-sm font-medium hover:opacity-90">
                Open admin panel
              </Link>
              <Link to="/auth" className="rounded-md border border-border px-5 py-2.5 text-sm font-medium hover:bg-surface">
                Sign in
              </Link>
            </div>
            <div className="mt-10 grid grid-cols-2 md:grid-cols-3 gap-3 text-left">
              {CATEGORIES.map((c) => (
                <Link
                  key={c.slug}
                  to="/browse/$category"
                  params={{ category: c.slug }}
                  className="rounded-xl border border-border p-4 hover:border-ring transition-colors bg-surface/50"
                >
                  <div className="text-sm text-muted-foreground">Browse</div>
                  <div className="font-semibold">{c.label}</div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {!empty && (
          <div className="mx-auto max-w-7xl py-4 sm:py-8">
            <AdSlot placement="homepage_banner" className="px-4 md:px-6 mb-4" />
            {order.map((key, idx) => {
              const s = sections[key];
              return (
                <div key={key}>
                  <TitleRow
                    title={s.title}
                    items={s.q.data}
                    loading={s.q.isLoading}
                    emptyHint={s.hint}
                    viewAllHref={s.href}
                  />
                  {idx === Math.floor(order.length / 2) - 1 && (
                    <AdSlot placement="between_rows" className="px-4 md:px-6 my-4" />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
