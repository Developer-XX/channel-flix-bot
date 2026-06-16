import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Trash2, Search, Star, X } from "lucide-react";
import { toast } from "sonner";
import { tmdbSearch, tmdbDetails, tmdbFindByImdb } from "@/lib/tmdb.functions";
import { slugify } from "@/lib/slug";
import { Button } from "@/components/ui/button";
import { CATEGORIES, type CategorySlug } from "@/lib/categories";
import { createAdminTitle, deleteAdminTitle, listAdminTitles, updateAdminTitleFlag, updateAdminTitleStatus } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/titles")({
  component: TitlesAdmin,
});

function TitlesAdmin() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);

  const list = useQuery({
    queryKey: ["admin-titles"],
    queryFn: () => listAdminTitles(),
  });

  const togglePublish = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await updateAdminTitleStatus({ data: { id, status: status as "draft" | "published" | "archived" } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-titles"] });
      toast.success("Updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleFlag = useMutation({
    mutationFn: async ({ id, field, value }: { id: string; field: "is_trending" | "is_featured"; value: boolean }) => {
      await updateAdminTitleFlag({ data: { id, field, value } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-titles"] }),
  });

  const deleteTitle = useMutation({
    mutationFn: async (id: string) => {
      await deleteAdminTitle({ data: { id } });
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
  const [mode, setMode] = useState<"tmdb" | "manual">("tmdb");
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-2xl rounded-2xl border border-border bg-card shadow-card max-h-[88vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="font-display text-xl font-bold">Add title</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex gap-1 px-5 pt-3 border-b border-border">
          {(["tmdb", "manual"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-2 text-sm rounded-t-md border-b-2 -mb-px transition ${
                mode === m ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {m === "tmdb" ? "Import from TMDB" : "Manual entry"}
            </button>
          ))}
        </div>
        {mode === "tmdb" ? <TmdbImportPane onCreated={onCreated} /> : <ManualEntryPane onCreated={onCreated} />}
      </div>
    </div>
  );
}

function TmdbImportPane({ onCreated }: { onCreated: () => void }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"movie" | "tv" | "multi">("multi");
  const [lookupBy, setLookupBy] = useState<"name" | "imdb">("name");
  const [category, setCategory] = useState<CategorySlug>("movie");
  const [results, setResults] = useState<Awaited<ReturnType<typeof tmdbSearch>>["results"]>([]);
  const [searching, setSearching] = useState(false);
  const [importing, setImporting] = useState<number | null>(null);

  const search = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    try {
      if (lookupBy === "imdb") {
        const match = await tmdbFindByImdb({ data: { imdb_id: q } });
        setResults([
          {
            tmdb_id: match.tmdb_id,
            media_type: match.media_type,
            title: match.title,
            overview: "",
            poster_url: match.poster_url,
            backdrop_url: null,
            release_year: null,
            release_date: null,
            rating: null,
            language: "",
          },
        ] as Awaited<ReturnType<typeof tmdbSearch>>["results"]);
      } else {
        const r = await tmdbSearch({ data: { query: q, kind } });
        setResults(r.results);
      }
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
      await createAdminTitle({ data: {
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
      } });
      toast.success(`Imported "${d.title}"`);
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(null);
    }
  };

  return (
    <>
      <div className="p-5 space-y-3 border-b border-border">
        <div className="inline-flex rounded-md border border-border bg-surface p-0.5 text-xs">
          {(["name", "imdb"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { setLookupBy(m); setResults([]); setQuery(""); }}
              className={`px-3 py-1.5 rounded ${lookupBy === m ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {m === "name" ? "By name" : "By IMDb ID"}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") search(); }}
            placeholder={lookupBy === "imdb" ? "tt1234567" : "Search TMDB…"}
            className="flex-1 min-w-[180px] h-10 rounded-md bg-surface px-3 text-sm outline-none border border-border focus:border-ring transition font-mono-tabular"
          />
          {lookupBy === "name" && (
            <select value={kind} onChange={(e) => setKind(e.target.value as "movie" | "tv" | "multi")} className="h-10 rounded-md bg-surface border border-border px-2 text-sm">
              <option value="multi">Any</option>
              <option value="movie">Movies</option>
              <option value="tv">TV</option>
            </select>
          )}
          <Button onClick={search} disabled={searching} className="bg-gradient-primary text-primary-foreground border-0">
            <Search className="h-4 w-4 mr-1.5" />{searching ? "…" : lookupBy === "imdb" ? "Lookup" : "Search"}
          </Button>
        </div>
        {lookupBy === "imdb" && (
          <p className="text-[11px] text-muted-foreground">
            Paste an IMDb ID (e.g. <code className="bg-surface px-1 rounded">tt0903747</code>) to import via TMDB's external-id lookup.
          </p>
        )}
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
          <div key={`${r.media_type}-${r.tmdb_id}`} className="flex gap-3 rounded-xl border border-border bg-surface/50 p-3 min-w-0">
            {r.poster_url ? <img src={r.poster_url} alt="" className="h-24 w-16 shrink-0 object-cover rounded" /> : <div className="h-24 w-16 shrink-0 bg-surface rounded" />}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
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
    </>
  );
}

function ManualEntryPane({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({
    title: "",
    original_title: "",
    slug: "",
    category: "movie" as CategorySlug,
    status: "published" as "draft" | "published" | "archived",
    overview: "",
    poster_url: "",
    backdrop_url: "",
    release_year: "",
    release_date: "",
    runtime_minutes: "",
    rating: "",
    language: "",
    genres: "",
    cast_names: "",
    tmdb_id: "",
    imdb_id: "",
  });
  const [saving, setSaving] = useState(false);

  function update<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) { toast.error("Title is required"); return; }
    setSaving(true);
    try {
      const slug = (form.slug.trim() || slugify(`${form.title}-${form.release_year || ""}`)).trim();
      const toNum = (s: string) => (s.trim() ? Number(s) : null);
      const toArr = (s: string) => (s.trim() ? s.split(",").map((x) => x.trim()).filter(Boolean) : null);
      await createAdminTitle({ data: {
        slug,
        title: form.title.trim(),
        original_title: form.original_title.trim() || null,
        category: form.category as never,
        status: form.status as never,
        overview: form.overview.trim() || null,
        poster_url: form.poster_url.trim() || null,
        backdrop_url: form.backdrop_url.trim() || null,
        release_year: toNum(form.release_year),
        release_date: form.release_date.trim() || null,
        runtime_minutes: toNum(form.runtime_minutes),
        rating: toNum(form.rating),
        language: form.language.trim() || null,
        genres: toArr(form.genres),
        cast_names: toArr(form.cast_names),
        tmdb_id: toNum(form.tmdb_id),
        imdb_id: form.imdb_id.trim() || null,
      } });
      toast.success(`Created "${form.title}"`);
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create failed");
    } finally {
      setSaving(false);
    }
  };

  const Field = (props: { label: string; children: React.ReactNode; full?: boolean }) => (
    <label className={`block ${props.full ? "sm:col-span-2" : ""}`}>
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{props.label}</span>
      <div className="mt-1">{props.children}</div>
    </label>
  );
  const inputCls =
    "w-full h-9 rounded-md bg-surface px-3 text-sm outline-none border border-border focus:border-ring transition";

  return (
    <form onSubmit={submit} className="flex-1 overflow-y-auto p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title*">
          <input className={inputCls} value={form.title} onChange={(e) => update("title", e.target.value)} required />
        </Field>
        <Field label="Original title">
          <input className={inputCls} value={form.original_title} onChange={(e) => update("original_title", e.target.value)} />
        </Field>
        <Field label="Slug (auto if blank)">
          <input className={inputCls} value={form.slug} onChange={(e) => update("slug", e.target.value)} placeholder="my-title-2024" />
        </Field>
        <Field label="Category">
          <select className={inputCls} value={form.category} onChange={(e) => update("category", e.target.value as CategorySlug)}>
            {CATEGORIES.map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select className={inputCls} value={form.status} onChange={(e) => update("status", e.target.value as typeof form.status)}>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
        </Field>
        <Field label="Release year">
          <input className={inputCls} type="number" value={form.release_year} onChange={(e) => update("release_year", e.target.value)} />
        </Field>
        <Field label="Release date">
          <input className={inputCls} type="date" value={form.release_date} onChange={(e) => update("release_date", e.target.value)} />
        </Field>
        <Field label="Runtime (min)">
          <input className={inputCls} type="number" value={form.runtime_minutes} onChange={(e) => update("runtime_minutes", e.target.value)} />
        </Field>
        <Field label="Rating (0-10)">
          <input className={inputCls} type="number" step="0.1" value={form.rating} onChange={(e) => update("rating", e.target.value)} />
        </Field>
        <Field label="Language (ISO)">
          <input className={inputCls} value={form.language} onChange={(e) => update("language", e.target.value)} placeholder="en" />
        </Field>
        <Field label="TMDB ID">
          <input className={inputCls} type="number" value={form.tmdb_id} onChange={(e) => update("tmdb_id", e.target.value)} />
        </Field>
        <Field label="IMDB ID">
          <input className={inputCls} value={form.imdb_id} onChange={(e) => update("imdb_id", e.target.value)} placeholder="tt1234567" />
        </Field>
        <Field label="Poster URL" full>
          <input className={inputCls} value={form.poster_url} onChange={(e) => update("poster_url", e.target.value)} placeholder="https://…" />
        </Field>
        <Field label="Backdrop URL" full>
          <input className={inputCls} value={form.backdrop_url} onChange={(e) => update("backdrop_url", e.target.value)} placeholder="https://…" />
        </Field>
        <Field label="Genres (comma-separated)" full>
          <input className={inputCls} value={form.genres} onChange={(e) => update("genres", e.target.value)} placeholder="Action, Drama" />
        </Field>
        <Field label="Cast (comma-separated)" full>
          <input className={inputCls} value={form.cast_names} onChange={(e) => update("cast_names", e.target.value)} placeholder="Actor One, Actor Two" />
        </Field>
        <Field label="Overview" full>
          <textarea className={`${inputCls} h-24 py-2`} value={form.overview} onChange={(e) => update("overview", e.target.value)} />
        </Field>
      </div>
      <div className="flex justify-end gap-2 pt-4 mt-4 border-t border-border">
        <Button type="submit" disabled={saving} className="bg-gradient-primary text-primary-foreground border-0">
          {saving ? "Saving…" : "Create title"}
        </Button>
      </div>
    </form>
  );
}
