import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Star, Clock, Calendar, Globe, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { CATEGORY_LABEL } from "@/lib/categories";
import { Button } from "@/components/ui/button";
import { DownloadButton } from "@/components/DownloadButton";
import { SeasonAccordion } from "@/components/SeasonAccordion";
import { TitleDebugPanel } from "@/components/TitleDebugPanel";

export const Route = createFileRoute("/title/$slug")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.slug} — StreamVault` },
      { property: "og:url", content: `/title/${params.slug}` },
      { property: "og:type", content: "video.other" },
    ],
    links: [{ rel: "canonical", href: `/title/${params.slug}` }],
  }),
  component: TitlePage,
  notFoundComponent: () => (
    <div className="min-h-screen grid place-items-center text-muted-foreground">
      Title not found.
    </div>
  ),
  errorComponent: ({ error }) => (
    <div className="min-h-screen grid place-items-center text-destructive">{error.message}</div>
  ),
});

function TitlePage() {
  const { slug } = Route.useParams();

  const titleQ = useQuery({
    queryKey: ["title", slug],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("master_titles")
        .select("*")
        .eq("slug", slug)
        .eq("status", "published")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw notFound();
      return data;
    },
  });

  const filesQ = useQuery({
    queryKey: ["title-files", titleQ.data?.id],
    enabled: !!titleQ.data?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("media_files")
        .select("id, file_name, quality, resolution, language, file_size")
        .eq("title_id", titleQ.data!.id)
        .eq("is_active", true)
        .order("resolution", { ascending: false, nullsFirst: false })
        .order("quality", { ascending: false, nullsFirst: false })
        .order("file_name", { ascending: true });
      return data ?? [];
    },
  });

  const seasonsQ = useQuery({
    queryKey: ["title-seasons", titleQ.data?.id],
    enabled: !!titleQ.data?.id && titleQ.data?.category !== "movie",
    queryFn: async () => {
      const { data } = await supabase
        .from("seasons")
        .select("id, season_number, name, episode_count, poster_url")
        .eq("title_id", titleQ.data!.id)
        .order("season_number");
      return data ?? [];
    },
  });

  if (titleQ.isLoading) {
    return (
      <div className="min-h-screen">
        <SiteHeader />
        <div className="pt-14 sm:pt-16">
          <div className="h-[40vh] sm:h-[55vh] animate-pulse bg-gradient-to-b from-surface to-background" />
          <div className="mx-auto max-w-7xl px-4 md:px-6 -mt-24 sm:-mt-32 grid gap-4 grid-cols-[96px_minmax(0,1fr)] sm:grid-cols-[160px_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)]">
            <div className="aspect-[2/3] w-full rounded-xl bg-surface animate-pulse" />
            <div className="space-y-3 pt-6">
              <div className="h-6 sm:h-8 w-3/4 bg-surface rounded animate-pulse" />
              <div className="h-4 w-1/2 bg-surface rounded animate-pulse" />
              <div className="h-3 w-full bg-surface rounded animate-pulse mt-4" />
              <div className="h-3 w-5/6 bg-surface rounded animate-pulse" />
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (!titleQ.data) return null;
  const t = titleQ.data;

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1">
        <div className="relative">
          {t.backdrop_url && (
            <img
              src={t.backdrop_url}
              alt=""
              fetchPriority="high"
              decoding="async"
              loading="eager"
              className="absolute inset-0 h-[55vh] sm:h-[65vh] md:h-[80vh] w-full object-cover object-top"
            />
          )}
          <div className="absolute inset-0 h-[55vh] sm:h-[65vh] md:h-[80vh] bg-gradient-to-b from-background/60 via-background/85 to-background" />
          <div className="relative mx-auto max-w-7xl px-4 md:px-6 pt-24 sm:pt-28 pb-10 md:pb-12 grid gap-4 sm:gap-6 md:gap-8 grid-cols-[96px_minmax(0,1fr)] sm:grid-cols-[160px_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)]">
            <div className="min-w-0">
              {t.poster_url ? (
                <img
                  src={t.poster_url}
                  alt={`${t.title} poster`}
                  className="rounded-xl md:rounded-2xl shadow-card aspect-[2/3] w-full object-cover"
                  loading="eager"
                  decoding="async"
                  fetchPriority="high"
                />
              ) : (
                <div className="rounded-xl md:rounded-2xl bg-surface aspect-[2/3]" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-[11px] sm:text-xs uppercase tracking-widest text-primary font-semibold">
                {CATEGORY_LABEL[t.category as keyof typeof CATEGORY_LABEL]}
              </p>
              <h1 className="mt-2 font-display text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold leading-tight break-words">
                {t.title}
              </h1>
              {t.original_title && t.original_title !== t.title && (
                <p className="text-muted-foreground mt-1 text-sm sm:text-base truncate">{t.original_title}</p>
              )}
              <div className="mt-3 sm:mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs sm:text-sm text-muted-foreground">
                {t.rating != null && (
                  <span className="inline-flex items-center gap-1.5">
                    <Star className="h-4 w-4 fill-gold text-gold shrink-0" />
                    <span className="text-foreground font-medium">{Number(t.rating).toFixed(1)}</span>
                  </span>
                )}
                {t.release_year && (
                  <span className="inline-flex items-center gap-1.5"><Calendar className="h-4 w-4 shrink-0" />{t.release_year}</span>
                )}
                {t.runtime_minutes && (
                  <span className="inline-flex items-center gap-1.5"><Clock className="h-4 w-4 shrink-0" />{t.runtime_minutes} min</span>
                )}
                {t.language && (
                  <span className="inline-flex items-center gap-1.5 uppercase"><Globe className="h-4 w-4 shrink-0" />{t.language}</span>
                )}
              </div>
              {Array.isArray(t.genres) && t.genres.length > 0 && (
                <div className="mt-3 sm:mt-4 flex flex-wrap gap-1.5 sm:gap-2">
                  {t.genres.map((g) => (
                    <span key={g} className="rounded-full border border-border bg-surface/60 px-2.5 py-1 text-[11px] sm:text-xs">{g}</span>
                  ))}
                </div>
              )}
            </div>
            {/* Overview + cast wrap below on mobile to use full width */}
            <div className="col-span-2 lg:col-start-2 lg:col-end-3 min-w-0">
              {t.overview && (
                <p className="text-sm sm:text-base md:text-lg text-foreground/85 leading-relaxed max-w-3xl">{t.overview}</p>
              )}
              {Array.isArray(t.cast_names) && t.cast_names.length > 0 && (
                <p className="mt-4 text-xs sm:text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Cast:</span> {t.cast_names.slice(0, 8).join(", ")}
                </p>
              )}
            </div>
          </div>
        </div>

        <section className="mx-auto max-w-7xl px-4 md:px-6 py-6 sm:py-8">
          <h2 className="font-display text-xl sm:text-2xl font-bold mb-3 sm:mb-4">Downloads</h2>
          {t.category === "movie" ? (
            filesQ.isLoading ? (
              <p className="text-muted-foreground text-sm">Loading…</p>
            ) : !filesQ.data?.length ? (
              <div className="rounded-2xl border border-dashed border-border p-6 sm:p-8 text-center">
                <p className="text-muted-foreground text-sm sm:text-base">No download files indexed yet for this title.</p>
                <p className="mt-2 text-xs sm:text-sm text-muted-foreground">
                  Files appear here once the Telegram bot syncs them from a connected channel.
                </p>
              </div>
            ) : (
              <div className="grid gap-3 xl:grid-cols-2">
                {filesQ.data.map((f) => (
                  <div
                    key={f.id}
                    className="grid grid-cols-[auto_minmax(0,1fr)] sm:grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 rounded-xl border border-border bg-surface/50 p-3 sm:p-4 min-w-0"
                  >
                    <div className="grid h-10 w-10 sm:h-12 sm:w-12 shrink-0 place-items-center rounded-lg bg-gradient-primary text-primary-foreground">
                      <Download className="h-4 w-4 sm:h-5 sm:w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-sm sm:text-base truncate">{f.file_name}</div>
                      <div className="text-[11px] sm:text-xs text-muted-foreground flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
                        {f.quality && <span>{f.quality}</span>}
                        {f.resolution && <span>· {f.resolution}</span>}
                        {f.language && <span>· {f.language.toUpperCase()}</span>}
                        {f.file_size && <span>· {(Number(f.file_size) / 1024 / 1024).toFixed(0)} MB</span>}
                      </div>
                    </div>
                    <div className="col-span-2 sm:col-span-1 shrink-0 justify-self-stretch sm:justify-self-end">
                      <DownloadButton mediaFileId={f.id} fileName={f.file_name} titleId={t.id} />
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            <SeasonAccordion titleId={t.id} />
          )}
        </section>

        <TitleDebugPanel slug={slug} />

        {seasonsQ.data && seasonsQ.data.length > 0 && (
          <section className="mx-auto max-w-7xl px-4 md:px-6 py-8">
            <h2 className="font-display text-2xl font-bold mb-4">Seasons</h2>
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {seasonsQ.data.map((s) => (
                <div key={s.id} className="rounded-xl border border-border bg-surface/50 p-4">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">Season {s.season_number}</div>
                  <div className="font-semibold mt-1">{s.name ?? `Season ${s.season_number}`}</div>
                  <div className="text-sm text-muted-foreground mt-1">{s.episode_count} episodes</div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="mx-auto max-w-7xl px-4 md:px-6 py-8">
          <div className="rounded-2xl bg-gradient-to-br from-surface to-background border border-border p-8 text-center">
            <p className="text-sm text-muted-foreground mb-2">Don't see what you want?</p>
            <h3 className="font-display text-2xl font-bold">Request a title</h3>
            <p className="mt-2 text-muted-foreground">We'll review your request and notify you when it's available.</p>
            <Link to="/request" className="mt-4 inline-flex">
              <Button className="bg-gradient-primary text-primary-foreground border-0">Make a request</Button>
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
