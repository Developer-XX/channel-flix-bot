import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const TMDB_BASE = "https://api.themoviedb.org/3";
const IMAGE_BASE = "https://image.tmdb.org/t/p";

function key() {
  const k = process.env.TMDB_API_KEY;
  if (!k) throw new Error("TMDB_API_KEY not configured");
  return k;
}

const SearchSchema = z.object({
  query: z.string().min(1).max(200),
  kind: z.enum(["movie", "tv", "multi"]).default("multi"),
});

export const tmdbSearch = createServerFn({ method: "POST" })
  .inputValidator((input) => SearchSchema.parse(input))
  .handler(async ({ data }) => {
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
  .inputValidator((input) => DetailsSchema.parse(input))
  .handler(async ({ data }) => {
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
    };
  });
