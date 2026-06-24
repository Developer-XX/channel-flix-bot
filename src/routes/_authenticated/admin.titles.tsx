import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Trash2, Search, Star, X, Pencil, RotateCw, Images } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { tmdbSearch, tmdbDetails, tmdbFindByImdb } from "@/lib/tmdb.functions";
import { slugify } from "@/lib/slug";
import { Button } from "@/components/ui/button";
import { CATEGORIES, type CategorySlug } from "@/lib/categories";
import { createAdminTitle, deleteAdminTitle, listAdminTitles, updateAdminTitleFlag, updateAdminTitleStatus, getAdminTitle, updateAdminTitle } from "@/lib/admin.functions";
import { adminAddTitleToSlideshow } from "@/lib/homepage.functions";
import { resyncTitleFiles } from "@/lib/telegram.functions";


export const Route = createFileRoute("/_authenticated/admin/titles")({
  component: TitlesAdmin,
});

function TitlesAdmin() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const list = useQuery({
    queryKey: ["admin-titles"],
    queryFn: () => listAdminTitles(),
  });

  const filtered = (list.data ?? []).filter((t) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      t.title.toLowerCase().includes(q) ||
      t.slug.toLowerCase().includes(q) ||
      (t.category ?? "").toLowerCase().includes(q)
    );
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
                    <AddToSlideshowButton titleId={t.id} titleName={t.title} />
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex items-center gap-1">
                    <ResyncTitleButton titleId={t.id} titleName={t.title} />
                    <button
                      onClick={() => setEditingId(t.id)}
                      className="text-muted-foreground hover:text-foreground p-1"
                      aria-label="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => { if (confirm(`Delete ${t.title}?`)) deleteTitle.mutate(t.id); }}
                      className="text-muted-foreground hover:text-destructive p-1"
                      aria-label="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>

              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {adding && <AddTitleDialog onClose={() => setAdding(false)} onCreated={() => { qc.invalidateQueries({ queryKey: ["admin-titles"] }); setAdding(false); }} />}
      {editingId && (
        <EditTitleDialog
          id={editingId}
          onClose={() => setEditingId(null)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ["admin-titles"] }); setEditingId(null); }}
        />
      )}
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
  const [preview, setPreview] = useState<
    | null
    | {
        details: Awaited<ReturnType<typeof tmdbDetails>>;
        media_type: "movie" | "tv";
        category: CategorySlug;
        slug: string;
      }
  >(null);
  const [committing, setCommitting] = useState(false);

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

  // Step 1: resolve TMDB details and show a preview the admin can review.
  const openPreview = async (tmdb_id: number, media_type: string) => {
    setImporting(tmdb_id);
    try {
      const mt: "movie" | "tv" = media_type === "tv" ? "tv" : "movie";
      const d = await tmdbDetails({ data: { tmdb_id, media_type: mt } });
      const finalCategory: CategorySlug = mt === "tv" ? (category === "movie" ? "series" : category) : "movie";
      setPreview({
        details: d,
        media_type: mt,
        category: finalCategory,
        slug: slugify(`${d.title}-${d.release_year ?? ""}`),
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load TMDB details");
    } finally {
      setImporting(null);
    }
  };

  // Step 2: commit the previewed title.
  const commitPreview = async () => {
    if (!preview) return;
    setCommitting(true);
    try {
      const { details: d, category: finalCategory, slug } = preview;
      await createAdminTitle({ data: {
        slug: slug.trim() || slugify(`${d.title}-${d.release_year ?? ""}`),
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
      setPreview(null);
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setCommitting(false);
    }
  };

  if (preview) {
    const d = preview.details;
    return (
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={() => setPreview(null)}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            ← Back to results
          </button>
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          {d.poster_url ? (
            <img src={d.poster_url} alt="" className="h-48 w-32 shrink-0 rounded-lg object-cover border border-border" />
          ) : (
            <div className="h-48 w-32 shrink-0 rounded-lg bg-surface border border-border" />
          )}
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider bg-surface px-1.5 py-0.5 rounded">{preview.media_type}</span>
              <h3 className="font-display text-xl font-bold truncate">{d.title}</h3>
              {d.release_year && <span className="text-sm text-muted-foreground">{d.release_year}</span>}
            </div>
            {d.original_title && d.original_title !== d.title && (
              <p className="text-xs text-muted-foreground">Original: <em>{d.original_title}</em></p>
            )}
            <div className="flex flex-wrap gap-1.5">
              {d.genres?.slice(0, 6).map((g) => (
                <span key={g} className="text-[11px] bg-surface border border-border rounded-full px-2 py-0.5">{g}</span>
              ))}
            </div>
            <p className="text-sm text-muted-foreground line-clamp-4">{d.overview || "No overview."}</p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs pt-1">
              <dt className="text-muted-foreground">TMDB</dt><dd className="font-mono">{d.tmdb_id}</dd>
              <dt className="text-muted-foreground">IMDb</dt><dd className="font-mono">{d.imdb_id ?? "—"}</dd>
              <dt className="text-muted-foreground">Runtime</dt><dd>{d.runtime_minutes ? `${d.runtime_minutes} min` : "—"}</dd>
              <dt className="text-muted-foreground">Rating</dt><dd>{d.rating ? d.rating.toFixed(1) : "—"}</dd>
              <dt className="text-muted-foreground">Language</dt><dd>{d.language ?? "—"}</dd>
              <dt className="text-muted-foreground">Release</dt><dd>{d.release_date ?? "—"}</dd>
            </dl>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Slug</span>
            <input
              value={preview.slug}
              onChange={(e) => setPreview({ ...preview, slug: e.target.value })}
              className="mt-1 w-full h-9 rounded-md bg-surface px-3 text-sm border border-border focus:border-ring outline-none font-mono"
            />
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Category</span>
            <select
              value={preview.category}
              onChange={(e) => setPreview({ ...preview, category: e.target.value as CategorySlug })}
              className="mt-1 w-full h-9 rounded-md bg-surface px-3 text-sm border border-border focus:border-ring outline-none"
            >
              {CATEGORIES.map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)}
            </select>
          </label>
        </div>

        {preview.media_type === "tv" && (
          <div className="rounded-xl border border-border bg-surface/40 p-4">
            <div className="flex items-baseline justify-between gap-2 mb-3">
              <h4 className="font-semibold text-sm">Season &amp; episode mapping</h4>
              <span className="text-xs text-muted-foreground">
                {d.number_of_seasons ?? 0} season{(d.number_of_seasons ?? 0) === 1 ? "" : "s"} ·{" "}
                {d.number_of_episodes ?? 0} episode{(d.number_of_episodes ?? 0) === 1 ? "" : "s"}
              </span>
            </div>
            {d.seasons && d.seasons.length > 0 ? (
              <div className="max-h-56 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground text-[10px] uppercase tracking-wider">
                    <tr>
                      <th className="text-left px-2 py-1.5">#</th>
                      <th className="text-left px-2 py-1.5">Name</th>
                      <th className="text-left px-2 py-1.5">Episodes</th>
                      <th className="text-left px-2 py-1.5">Air date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.seasons.map((s) => (
                      <tr key={s.season_number} className="border-t border-border">
                        <td className="px-2 py-1.5 font-mono">S{String(s.season_number).padStart(2, "0")}</td>
                        <td className="px-2 py-1.5 truncate">{s.name}</td>
                        <td className="px-2 py-1.5">{s.episode_count}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">{s.air_date ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">TMDB returned no season data.</p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-border">
          <Button variant="ghost" onClick={() => setPreview(null)} disabled={committing}>
            Cancel
          </Button>
          <Button
            onClick={commitPreview}
            disabled={committing || !preview.slug.trim()}
            className="bg-gradient-primary text-primary-foreground border-0"
          >
            {committing ? "Importing…" : "Confirm import"}
          </Button>
        </div>
      </div>
    );
  }



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
            <Button size="sm" onClick={() => openPreview(r.tmdb_id, r.media_type)} disabled={importing === r.tmdb_id} className="shrink-0">
              {importing === r.tmdb_id ? "…" : "Preview"}
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

function EditTitleDialog({ id, onClose, onSaved }: { id: string; onClose: () => void; onSaved: () => void }) {
  const titleQ = useQuery({ queryKey: ["admin-title", id], queryFn: () => getAdminTitle({ data: { id } }) });
  const [form, setForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const Field = (props: { label: string; children: React.ReactNode; full?: boolean }) => (
    <label className={`block ${props.full ? "sm:col-span-2" : ""}`}>
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{props.label}</span>
      <div className="mt-1">{props.children}</div>
    </label>
  );


  // hydrate once when data arrives
  if (titleQ.data && !form) {
    const t: any = titleQ.data;
    setForm({
      slug: t.slug ?? "",
      title: t.title ?? "",
      original_title: t.original_title ?? "",
      category: t.category ?? "movie",
      status: t.status ?? "draft",
      release_year: t.release_year ?? "",
      release_date: t.release_date ?? "",
      runtime_minutes: t.runtime_minutes ?? "",
      rating: t.rating ?? "",
      language: t.language ?? "",
      poster_url: t.poster_url ?? "",
      backdrop_url: t.backdrop_url ?? "",
      trailer_url: t.trailer_url ?? "",
      genres: Array.isArray(t.genres) ? t.genres.join(", ") : "",
      cast_names: Array.isArray(t.cast_names) ? t.cast_names.join(", ") : "",
      overview: t.overview ?? "",
      tmdb_id: t.tmdb_id ?? "",
      imdb_id: t.imdb_id ?? "",
    });
  }

  const inputCls = "w-full h-9 rounded-md bg-surface px-3 text-sm border border-border focus:border-ring outline-none";
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const verifySummary = () => {
    if (!form) return null;
    const issues: string[] = [];
    const ok: string[] = [];
    if (!form.title.trim()) issues.push("Title is empty");
    else ok.push("Title set");
    if (!/^[a-z0-9-]+$/.test(form.slug)) issues.push("Slug must be lowercase letters, digits, dashes");
    else ok.push("Slug looks valid");
    if (!form.poster_url) issues.push("Missing poster");
    else ok.push("Poster set");
    if (!form.overview) issues.push("Missing overview");
    else ok.push("Overview set");
    if (!form.release_year && !form.release_date) issues.push("No release year/date");
    if (!form.genres) issues.push("No genres");
    return { ok, issues };
  };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const payload: any = {
        id,
        slug: form.slug,
        title: form.title,
        original_title: form.original_title || null,
        category: form.category,
        status: form.status,
        overview: form.overview || null,
        poster_url: form.poster_url || null,
        backdrop_url: form.backdrop_url || null,
        trailer_url: form.trailer_url || null,
        release_year: form.release_year === "" ? null : Number(form.release_year),
        release_date: form.release_date || null,
        runtime_minutes: form.runtime_minutes === "" ? null : Number(form.runtime_minutes),
        rating: form.rating === "" ? null : Number(form.rating),
        language: form.language || null,
        genres: form.genres ? form.genres.split(",").map((s: string) => s.trim()).filter(Boolean) : null,
        cast_names: form.cast_names ? form.cast_names.split(",").map((s: string) => s.trim()).filter(Boolean) : null,
        tmdb_id: form.tmdb_id === "" ? null : Number(form.tmdb_id),
        imdb_id: form.imdb_id || null,
      };
      const r = await updateAdminTitle({ data: payload });
      const v = verifySummary();
      const summary = `Saved · ${r.changed} field(s) changed · ${v?.ok.length ?? 0} OK · ${v?.issues.length ?? 0} issue(s)`;
      setStatus(summary);
      if (v && v.issues.length === 0) {
        toast.success(summary);
        onSaved();
      } else {
        toast.message(summary);
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
      setStatus(`Error: ${e?.message ?? "save failed"}`);
    } finally {
      setSaving(false);
    }
  };

  const v = form ? verifySummary() : null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-3xl rounded-2xl border border-border bg-card shadow-card max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="font-display text-xl font-bold">Edit title</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        {titleQ.isLoading || !form ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Loading…</div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5 space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Title"><input className={inputCls} value={form.title} onChange={(e) => set("title", e.target.value)} /></Field>
              <Field label="Original title"><input className={inputCls} value={form.original_title} onChange={(e) => set("original_title", e.target.value)} /></Field>
              <Field label="Slug"><input className={`${inputCls} font-mono`} value={form.slug} onChange={(e) => set("slug", e.target.value)} /></Field>
              <Field label="Category">
                <select className={inputCls} value={form.category} onChange={(e) => set("category", e.target.value)}>
                  {CATEGORIES.map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)}
                </select>
              </Field>
              <Field label="Status">
                <select className={inputCls} value={form.status} onChange={(e) => set("status", e.target.value)}>
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                  <option value="archived">Archived</option>
                </select>
              </Field>
              <Field label="Language"><input className={inputCls} value={form.language} onChange={(e) => set("language", e.target.value)} /></Field>
              <Field label="Release year"><input className={inputCls} type="number" value={form.release_year} onChange={(e) => set("release_year", e.target.value)} /></Field>
              <Field label="Release date"><input className={inputCls} type="date" value={form.release_date ?? ""} onChange={(e) => set("release_date", e.target.value)} /></Field>
              <Field label="Runtime (min)"><input className={inputCls} type="number" value={form.runtime_minutes} onChange={(e) => set("runtime_minutes", e.target.value)} /></Field>
              <Field label="Rating"><input className={inputCls} type="number" step="0.1" value={form.rating} onChange={(e) => set("rating", e.target.value)} /></Field>
              <Field label="TMDB ID"><input className={inputCls} type="number" value={form.tmdb_id} onChange={(e) => set("tmdb_id", e.target.value)} /></Field>
              <Field label="IMDb ID"><input className={inputCls} value={form.imdb_id} onChange={(e) => set("imdb_id", e.target.value)} /></Field>
            </div>
            <Field label="Poster URL" full><input className={inputCls} value={form.poster_url} onChange={(e) => set("poster_url", e.target.value)} /></Field>
            <Field label="Backdrop URL" full><input className={inputCls} value={form.backdrop_url} onChange={(e) => set("backdrop_url", e.target.value)} /></Field>
            <Field label="Trailer URL" full><input className={inputCls} value={form.trailer_url} onChange={(e) => set("trailer_url", e.target.value)} /></Field>
            <Field label="Genres (comma separated)" full><input className={inputCls} value={form.genres} onChange={(e) => set("genres", e.target.value)} /></Field>
            <Field label="Cast (comma separated)" full><input className={inputCls} value={form.cast_names} onChange={(e) => set("cast_names", e.target.value)} /></Field>
            <Field label="Overview" full><textarea className={`${inputCls} h-28 py-2`} value={form.overview} onChange={(e) => set("overview", e.target.value)} /></Field>

            {v && (
              <div className="rounded-md border border-border p-3 text-xs space-y-1 bg-surface/40">
                <div className="font-semibold uppercase tracking-wider text-muted-foreground">Verification</div>
                {v.ok.map((m) => <div key={m} className="text-emerald-500">✓ {m}</div>)}
                {v.issues.map((m) => <div key={m} className="text-amber-500">⚠ {m}</div>)}
                {status && <div className="pt-1 border-t border-border mt-1">{status}</div>}
              </div>
            )}
          </div>
        )}
        <div className="flex items-center justify-end gap-2 p-4 border-t border-border">
          <AddToSlideshowButton titleId={id} titleName={form?.title ?? ""} variant="full" />
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || !form} className="bg-gradient-primary text-primary-foreground border-0">
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ResyncTitleButton({ titleId, titleName }: { titleId: string; titleName: string }) {
  const fn = useServerFn(resyncTitleFiles);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await fn({ data: { titleId } });
          toast.success(
            `${titleName}: ${r.promoted} matched · ${r.demoted} demoted · ${r.kept} kept · ${r.skipped} unmatched`,
          );
          qc.invalidateQueries({ queryKey: ["admin-titles"] });
        } catch (e) {
          toast.error((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
      className="text-muted-foreground hover:text-primary disabled:opacity-50 p-1"
      aria-label="Resync this title"
      title="Resync this title"
    >
      <RotateCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
    </button>
  );
}

function AddToSlideshowButton({
  titleId,
  titleName,
  variant = "icon",
}: {
  titleId: string;
  titleName: string;
  variant?: "icon" | "full";
}) {
  const fn = useServerFn(adminAddTitleToSlideshow);
  const [busy, setBusy] = useState(false);
  const handle = async () => {
    setBusy(true);
    try {
      const r = await fn({ data: { titleId } });
      toast.success(
        r.reactivated
          ? `Reactivated slide for "${titleName}"`
          : `Added "${titleName}" to the slideshow`,
      );
    } catch (e) {
      toast.error((e as Error).message || "Failed to add to slideshow");
    } finally {
      setBusy(false);
    }
  };
  if (variant === "full") {
    return (
      <Button variant="ghost" onClick={handle} disabled={busy || !titleId} className="mr-auto">
        <Images className="h-4 w-4 mr-1.5" />
        {busy ? "Adding…" : "Add to slideshow"}
      </Button>
    );
  }
  return (
    <button
      onClick={handle}
      disabled={busy}
      title="Add to homepage slideshow"
      aria-label="Add to homepage slideshow"
      className="text-xs px-2 py-1 rounded inline-flex items-center gap-1 bg-surface text-muted-foreground hover:text-foreground disabled:opacity-50"
    >
      <Images className="h-3 w-3" />Slideshow
    </button>
  );
}
