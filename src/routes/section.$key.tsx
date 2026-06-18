import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { TitleGrid } from "@/components/title-row";
import type { TitleCardData } from "@/components/title-card";
import { useIsAuthed } from "@/hooks/use-session-flag";
import { usePublicBrowsing } from "@/hooks/use-public-browsing";
import { logBlockedBrowsing } from "@/lib/blocked-access";

const SECTIONS: Record<string, { title: string; build: () => Promise<TitleCardData[]> }> = {
  trending: {
    title: "Trending now",
    build: async () => {
      const { data } = await supabase
        .from("master_titles")
        .select("id, slug, title, poster_url, release_year, rating, category")
        .eq("status", "published")
        .eq("is_trending", true)
        .order("view_count", { ascending: false })
        .limit(120);
      return (data ?? []) as TitleCardData[];
    },
  },
  latest: {
    title: "Latest additions",
    build: async () => {
      const { data } = await supabase
        .from("master_titles")
        .select("id, slug, title, poster_url, release_year, rating, category")
        .eq("status", "published")
        .order("created_at", { ascending: false })
        .limit(120);
      return (data ?? []) as TitleCardData[];
    },
  },
  featured: {
    title: "Featured",
    build: async () => {
      const { data } = await supabase
        .from("master_titles")
        .select("id, slug, title, poster_url, release_year, rating, category")
        .eq("status", "published")
        .eq("is_featured", true)
        .order("updated_at", { ascending: false })
        .limit(120);
      return (data ?? []) as TitleCardData[];
    },
  },
};

export const Route = createFileRoute("/section/$key")({
  beforeLoad: ({ params }) => {
    if (!SECTIONS[params.key]) throw notFound();
  },
  head: ({ params }) => ({
    meta: [
      { title: `${SECTIONS[params.key]?.title ?? "Section"} — StreamVault` },
      { name: "description", content: `All titles in ${SECTIONS[params.key]?.title ?? "this section"}.` },
    ],
  }),
  component: SectionPage,
  notFoundComponent: () => (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1 mx-auto max-w-3xl px-6 py-20 text-center">
        <h1 className="text-2xl font-display font-bold">Section not found</h1>
        <Link to="/" className="mt-4 inline-block text-primary hover:underline">Back to home</Link>
      </main>
      <SiteFooter />
    </div>
  ),
});

function SectionPage() {
  const { key } = Route.useParams();
  const section = SECTIONS[key]!;
  const q = useQuery({
    queryKey: ["section", key],
    queryFn: section.build,
  });

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1 mx-auto max-w-7xl w-full px-4 md:px-6 py-6 sm:py-10">
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-4 w-4" /> Home
        </Link>
        <h1 className="font-display text-2xl sm:text-3xl md:text-4xl font-bold mb-6">{section.title}</h1>
        <TitleGrid items={q.data} loading={q.isLoading} />
      </main>
      <SiteFooter />
    </div>
  );
}
