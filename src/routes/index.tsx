import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Hero } from "@/components/hero";
import { TitleRow } from "@/components/title-row";
import type { TitleCardData } from "@/components/title-card";
import { CATEGORIES } from "@/lib/categories";

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

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1">
        <Hero featured={featured.data} />

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
          <div className="mx-auto max-w-7xl py-8">
            <TitleRow title="Trending now" items={trending.data} loading={trending.isLoading} emptyHint="No trending titles yet." />
            <TitleRow title="Latest additions" items={latest.data} loading={latest.isLoading} emptyHint="Nothing added yet." />
            <TitleRow title="Movies" items={movies.data} loading={movies.isLoading} />
            <TitleRow title="Web Series" items={series.data} loading={series.isLoading} />
            <TitleRow title="Anime" items={anime.data} loading={anime.isLoading} />
            <TitleRow title="K-Drama" items={kdrama.data} loading={kdrama.isLoading} />
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
