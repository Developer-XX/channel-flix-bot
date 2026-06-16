import { createFileRoute, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { TitleGrid } from "@/components/title-row";
import type { TitleCardData } from "@/components/title-card";
import { CATEGORY_LABEL, isCategory } from "@/lib/categories";

export const Route = createFileRoute("/browse/$category")({
  beforeLoad: ({ params }) => {
    if (!isCategory(params.category)) throw notFound();
  },
  head: ({ params }) => {
    const label = isCategory(params.category) ? CATEGORY_LABEL[params.category] : "Browse";
    return {
      meta: [
        { title: `${label} — StreamVault` },
        { name: "description", content: `Browse ${label.toLowerCase()} on StreamVault. Premium streaming directory with downloads via Telegram.` },
        { property: "og:title", content: `${label} on StreamVault` },
        { property: "og:url", content: `/browse/${params.category}` },
      ],
      links: [{ rel: "canonical", href: `/browse/${params.category}` }],
    };
  },
  component: BrowseCategory,
  notFoundComponent: () => (
    <div className="min-h-screen grid place-items-center text-muted-foreground">
      Unknown category.
    </div>
  ),
  errorComponent: ({ error }) => (
    <div className="min-h-screen grid place-items-center text-destructive">{error.message}</div>
  ),
});

function BrowseCategory() {
  const { category } = Route.useParams();
  const label = CATEGORY_LABEL[category as keyof typeof CATEGORY_LABEL];

  const { data, isLoading } = useQuery({
    queryKey: ["browse", category],
    queryFn: async () => {
      const { data } = await supabase
        .from("master_titles")
        .select("id, slug, title, poster_url, release_year, rating, category")
        .eq("status", "published")
        .eq("category", category as never)
        .order("created_at", { ascending: false })
        .limit(60);
      return (data ?? []) as TitleCardData[];
    },
  });

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1 pt-24">
        <div className="mx-auto max-w-7xl px-4 md:px-6">
          <div className="mb-8">
            <p className="text-sm uppercase tracking-widest text-primary font-semibold">Browse</p>
            <h1 className="font-display text-4xl md:text-5xl font-bold mt-2">{label}</h1>
            <p className="mt-2 text-muted-foreground">
              {data?.length ? `${data.length} title${data.length === 1 ? "" : "s"} available` : "Loading catalog…"}
            </p>
          </div>
          <TitleGrid items={data} loading={isLoading} />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
