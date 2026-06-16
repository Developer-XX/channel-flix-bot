import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Trash2, Search, Star, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { tmdbSearch, tmdbDetails } from "@/lib/tmdb.functions";
import { slugify } from "@/lib/slug";
import { Button } from "@/components/ui/button";
import { CATEGORIES, type CategorySlug } from "@/lib/categories";

export const Route = createFileRoute("/_authenticated/admin/titles")({
  component: TitlesAdmin,
});

function TitlesAdmin() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);

  const list = useQuery({
    queryKey: ["admin-titles"],
    queryFn: async () => {
      const { data } = await supabase
        .from("master_titles")
        .select("id, slug, title, category, status, release_year, rating, poster_url, is_trending, is_featured")
        .order("created_at", { ascending: false })
        .limit(200);
      return data ?? [];
    },
  });

  const togglePublish = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("master_titles").update({ status: status as never }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-titles"] });
      toast.success("Updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleFlag = useMutation({
    mutationFn: async ({ id, field, value }: { id: string; field: "is_trending" | "is_featured"; value: boolean }) => {
      const update: Record<string, boolean> = { [field]: value };
      const { error } = await supabase.from("master_titles").update(update as never).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-titles"] }),
  });

  const deleteTitle = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("master_titles").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-titles"] });
      toast.success("Deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-6 md:p-10 max-w-6xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Titles</h1>
          <p className="mt-1 text-muted-foreground">{list.data?.length ?? 0} titles in the catalog</p>
        </div>
        <Button onClick={() => setAdding(true)} className="bg-gradient-primary text-primary-foreground border-0">
          <Plus className="h-4 w-4 mr-1.5" /> Add title
        </Button>
      </div>

      <div className="mt-8 rounded-2xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface text-muted-foreground text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-3">Title</th>
              <th className="text-left px-4 py-3 hidden md:table-cell">Category</th>
              <th className="text-left px-4 py-3 hidden md:table-cell">Year</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3 hidden lg:table-cell">Flags</th>
              <th className="text-right px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
            )}
            {!list.isLoading && (list.data?.length ?? 0) === 0 && (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">No titles yet. Click <strong>Add title</strong> to import one from TMDB.</td></tr>
            )}
            {list.data?.map((t) => (
              <tr key={t.id} className="border-t border-border hover:bg-surface/50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    {t.poster_url && <img src={t.poster_url} alt="" className="h-12 w-8 object-cover rounded" />}
                    <div className="min-w-0">
                      <div className="font-medium truncate">{t.title}</div>
                      <div className="text-xs text-muted-foreground truncate">/{t.slug}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 hidden md:table-cell capitalize">{t.category}</td>
                <td className="px-4 py-3 hidden md:table-cell">{t.release_year ?? "—"}</td>
                <td className="px-4 py-3">
                  <select
                    value={t.status}
                    onChange={(e) => togglePublish.mutate({ id: t.id, status: e.target.value })}
                    className="bg-surface border border-border rounded px-2 py-1 text-xs"
                  >
                    <option value="draft">Draft</option>
                    <option value="published">Published</option>
                    <option value="archived">Archived</option>
                  </select>
                </td>
                <td className="px-4 py-3 hidden lg:table-cell">
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => toggleFlag.mutate({ id: t.id, field: "is_trending", value: !t.is_trending })}
                      className={`text-xs px-2 py-1 rounded ${t.is_trending ? "bg-primary text-primary-foreground" : "bg-surface text-muted-foreground"}`}
                    >Trending</button>
                    <button
                      onClick={() => toggleFlag.mutate({ id: t.id, field: "is_featured", value: !t.is_featured })}
                      className={`text-xs px-2 py-1 rounded inline-flex items-center gap-1 ${t.is_featured ? "bg-gold text-gold-foreground" : "bg-surface text-muted-foreground"}`}
                    ><Star className="h-3 w-3" />Featured</button>
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => { if (confirm(`Delete ${t.title}?`)) deleteTitle.mutate(t.id); }}
                    className="text-muted-foreground hover:text-destructive p-1"
                    aria-label="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {adding && <AddTitleDialog onClose={() => setAdding(false)} onCreated={() => { qc.invalidateQueries({ queryKey: ["admin-titles"] }); setAdding(false); }} />}
    </div>
  );
}

function AddTitleDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"movie" | "tv" | "multi">("multi");
  const [category, setCategory] = useState<CategorySlug>("movie");
  const [results, setResults] = useState<Awaited<ReturnType<typeof tmdbSearch>>["results"]>([]);
  const [searching, setSearching] = useState(false);
  const [importing, setImporting] = useState<number | null>(null);

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const r = await tmdbSearch({ data: { query: query.trim(), kind } });
      setResults(r.results);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Search failed");
    } finally {
      setSearching(false);
    }
  };

  const importOne = async (tmdb_id: number, media_type: string) => {
    setImporting(tmdb_id);
    try {
      const mt = media_type === "tv" ? "tv" : "movie";
      const d = await tmdbDetails({ data: { tmdb_id, media_type: mt as "movie" | "tv" } });
      const finalCategory: CategorySlug = mt === "tv" ? (category === "movie" ? "series" : category) : "movie";
      const baseSlug = slugify(`${d.title}-${d.release_year ?? ""}`);
      const { error } = await supabase.from("master_titles").insert({
        slug: baseSlug,
        title: d.title,
        original_title: d.original_title,
        category: finalCategory as never,
        status: "published" as never,
        overview: d.overview,
        poster_url: d.poster_url,
        backdrop_url: d.backdrop_url,
        release_year: d.release_year,
        release_date: d.release_date,
        runtime_minutes: d.runtime_minutes,
        rating: d.rating,
        language: d.language,
        genres: d.genres,
        cast_names: d.cast_names,
        tmdb_id: d.tmdb_id,
        imdb_id: d.imdb_id,
      });
      if (error) {
        if (error.code === "23505") {
          toast.error("Already imported (duplicate slug or TMDB id).");
        } else throw error;
        return;
      }
      toast.success(`Imported "${d.title}"`);
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-2xl rounded-2xl border border-border bg-card shadow-card max-h-[88vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="font-display text-xl font-bold">Import from TMDB</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-5 space-y-3 border-b border-border">
          <div className="flex gap-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") search(); }}
              placeholder="Search TMDB…"
              className="flex-1 h-10 rounded-md bg-surface px-3 text-sm outline-none border border-border focus:border-ring transition"
            />
            <select value={kind} onChange={(e) => setKind(e.target.value as "movie" | "tv" | "multi")} className="h-10 rounded-md bg-surface border border-border px-2 text-sm">
              <option value="multi">Any</option>
              <option value="movie">Movies</option>
              <option value="tv">TV</option>
            </select>
            <Button onClick={search} disabled={searching} className="bg-gradient-primary text-primary-foreground border-0">
              <Search className="h-4 w-4 mr-1.5" />{searching ? "…" : "Search"}
            </Button>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Save TV imports as:</span>
            <select value={category} onChange={(e) => setCategory(e.target.value as CategorySlug)} className="bg-surface border border-border rounded px-2 py-1">
              {CATEGORIES.filter((c) => c.slug !== "movie").map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)}
            </select>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-2">
          {results.length === 0 && !searching && <p className="text-sm text-muted-foreground text-center py-6">Search TMDB to import titles with full metadata.</p>}
          {results.map((r) => (
            <div key={`${r.media_type}-${r.tmdb_id}`} className="flex gap-3 rounded-xl border border-border bg-surface/50 p-3">
              {r.poster_url ? <img src={r.poster_url} alt="" className="h-24 w-16 object-cover rounded" /> : <div className="h-24 w-16 bg-surface rounded" />}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider bg-surface px-1.5 py-0.5 rounded">{r.media_type}</span>
                  <span className="font-semibold truncate">{r.title}</span>
                  {r.release_year && <span className="text-xs text-muted-foreground">{r.release_year}</span>}
                </div>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{r.overview || "No overview."}</p>
              </div>
              <Button size="sm" onClick={() => importOne(r.tmdb_id, r.media_type)} disabled={importing === r.tmdb_id} className="shrink-0">
                {importing === r.tmdb_id ? "…" : "Import"}
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
