import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminAccess } from "@/lib/admin-auth";

const TMDB_BASE = "https://api.themoviedb.org/3";
const IMAGE_BASE = "https://image.tmdb.org/t/p";

async function key() {
  const { getSetting } = await import("@/lib/runtime-settings.server");
  const k = (await getSetting("TMDB_API_KEY")) ?? process.env.TMDB_API_KEY;
  if (!k) throw new Error("TMDB_API_KEY not configured");
  return k;
}

const SearchSchema = z.object({
  query: z.string().min(1).max(200),
  kind: z.enum(["movie", "tv", "multi"]).default("multi"),
});

export const tmdbSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => SearchSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requireAdminAccess(context);
    const url = new URL(`${TMDB_BASE}/search/${data.kind}`);
    url.searchParams.set("api_key", key());
    url.searchParams.set("query", data.query);
    url.searchParams.set("include_adult", "false");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`TMDB ${res.status}`);
    const json = (await res.json()) as { results?: Array<Record<string, unknown>> };
    const results = (json.results ?? []).slice(0, 12).map((r) => {
      const mediaType = (r.media_type as string) ?? (data.kind === "tv" ? "tv" : "movie");
      const isTv = mediaType === "tv";
      const title = (isTv ? r.name : r.title) as string | undefined;
      const date = (isTv ? r.first_air_date : r.release_date) as string | undefined;
      return {
        tmdb_id: r.id as number,
        media_type: mediaType,
        title: title ?? "Untitled",
        overview: (r.overview as string) ?? "",
        poster_url: r.poster_path ? `${IMAGE_BASE}/w500${r.poster_path}` : null,
        backdrop_url: r.backdrop_path ? `${IMAGE_BASE}/w1280${r.backdrop_path}` : null,
        release_year: date ? Number(date.slice(0, 4)) : null,
        release_date: date || null,
        rating: typeof r.vote_average === "number" ? Number(r.vote_average) : null,
        language: (r.original_language as string) ?? null,
      };
    });
    return { results };
  });

const DetailsSchema = z.object({
  tmdb_id: z.number().int(),
  media_type: z.enum(["movie", "tv"]),
});

export const tmdbDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => DetailsSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requireAdminAccess(context);
    const url = new URL(`${TMDB_BASE}/${data.media_type}/${data.tmdb_id}`);
    url.searchParams.set("api_key", key());
    url.searchParams.set("append_to_response", "credits");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`TMDB ${res.status}`);
    const r = (await res.json()) as Record<string, any>;
    const isTv = data.media_type === "tv";
    const title = (isTv ? r.name : r.title) as string;
    const date = (isTv ? r.first_air_date : r.release_date) as string | undefined;
    return {
      tmdb_id: r.id as number,
      title,
      original_title: (isTv ? r.original_name : r.original_title) ?? title,
      overview: r.overview ?? "",
      poster_url: r.poster_path ? `${IMAGE_BASE}/w500${r.poster_path}` : null,
      backdrop_url: r.backdrop_path ? `${IMAGE_BASE}/w1280${r.backdrop_path}` : null,
      release_year: date ? Number(date.slice(0, 4)) : null,
      release_date: date || null,
      runtime_minutes: isTv
        ? Array.isArray(r.episode_run_time) && r.episode_run_time[0]
          ? Number(r.episode_run_time[0])
          : null
        : r.runtime ?? null,
      rating: typeof r.vote_average === "number" ? Number(r.vote_average) : null,
      language: r.original_language ?? null,
      genres: Array.isArray(r.genres) ? r.genres.map((g: any) => String(g.name)) : [],
      cast_names: Array.isArray(r.credits?.cast)
        ? r.credits.cast.slice(0, 12).map((c: any) => String(c.name))
        : [],
      imdb_id: r.imdb_id ?? r.external_ids?.imdb_id ?? null,
      number_of_seasons: isTv ? (r.number_of_seasons ?? null) : null,
      number_of_episodes: isTv ? (r.number_of_episodes ?? null) : null,
      seasons: isTv && Array.isArray(r.seasons)
        ? r.seasons
            .filter((s: any) => Number(s.season_number) >= 0)
            .map((s: any) => ({
              season_number: Number(s.season_number),
              name: String(s.name ?? `Season ${s.season_number}`),
              episode_count: Number(s.episode_count ?? 0),
              air_date: (s.air_date as string) ?? null,
              poster_url: s.poster_path ? `${IMAGE_BASE}/w185${s.poster_path}` : null,
            }))
        : [],
    };
  });

const FindByImdbSchema = z.object({
  imdb_id: z
    .string()
    .trim()
    .regex(/^tt\d{6,10}$/i, "IMDb ID must look like tt1234567"),
});

/**
 * Resolve an IMDb ID (tt1234567) to a TMDB record via /find/{external_id}.
 * Returns the first movie or tv match so the admin can import without
 * knowing the TMDB ID.
 */
export const tmdbFindByImdb = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => FindByImdbSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requireAdminAccess(context);
    const imdb = data.imdb_id.toLowerCase();
    const url = new URL(`${TMDB_BASE}/find/${imdb}`);
    url.searchParams.set("api_key", key());
    url.searchParams.set("external_source", "imdb_id");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`TMDB ${res.status}`);
    const json = (await res.json()) as {
      movie_results?: Array<Record<string, unknown>>;
      tv_results?: Array<Record<string, unknown>>;
    };
    const movie = json.movie_results?.[0];
    const tv = json.tv_results?.[0];
    const pick = movie ?? tv;
    if (!pick) throw new Error(`No TMDB match for ${imdb}`);
    const media_type: "movie" | "tv" = movie ? "movie" : "tv";
    return {
      tmdb_id: pick.id as number,
      media_type,
      imdb_id: imdb,
      title: ((media_type === "tv" ? pick.name : pick.title) as string) ?? "Untitled",
      poster_url: pick.poster_path ? `${IMAGE_BASE}/w500${pick.poster_path}` : null,
    };
  });
