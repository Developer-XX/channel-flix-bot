import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { Search as SearchIcon } from "lucide-react";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { TitleGrid } from "@/components/title-row";
import type { TitleCardData } from "@/components/title-card";

const schema = z.object({
  q: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/search")({
  validateSearch: zodValidator(schema),
  head: () => ({
    meta: [
      { title: "Search — StreamVault" },
      { name: "description", content: "Search movies, series, anime, K-Drama and more on StreamVault." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SearchPage,
});

function SearchPage() {
  const { q } = Route.useSearch();
  const navigate = useNavigate();
  const [input, setInput] = useState(q);

  useEffect(() => setInput(q), [q]);

  const debounced = useDebounced(input, 300);
  useEffect(() => {
    if (debounced !== q) {
      navigate({ to: "/search", search: { q: debounced }, replace: true });
    }
  }, [debounced]);

  const { data, isLoading } = useQuery({
    queryKey: ["search", q],
    enabled: q.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("master_titles")
        .select("id, slug, title, poster_url, release_year, rating, category")
        .eq("status", "published")
        .ilike("title", `%${q}%`)
        .order("view_count", { ascending: false })
        .limit(48);
      return (data ?? []) as TitleCardData[];
    },
  });

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1 pt-24">
        <div className="mx-auto max-w-7xl px-4 md:px-6">
          <h1 className="font-display text-4xl font-bold">Search</h1>
          <div className="relative mt-6 max-w-2xl">
            <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <input
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a title…"
              className="h-14 w-full rounded-xl bg-surface pl-12 pr-4 text-base outline-none border border-border focus:border-ring focus:ring-2 focus:ring-ring/40 transition"
            />
          </div>
          <div className="mt-10">
            {!q ? (
              <p className="text-muted-foreground">Start typing to search the catalog.</p>
            ) : (
              <TitleGrid items={data} loading={isLoading} />
            )}
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
