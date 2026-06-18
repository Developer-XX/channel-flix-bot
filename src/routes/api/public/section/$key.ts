// Public, rate-limited, cached read endpoint for homepage sections.
// Used by /section/$key UI and by external contract tests.
//
//   GET /api/public/section/trending
//   GET /api/public/section/latest
//   GET /api/public/section/featured
//
// Responses include RateLimit-* headers (RFC 9331 draft) and a JSON envelope
// with deterministic ordering. Cache is keyed by `cache_version` and
// invalidated whenever the global cache_version bumps (index rebuild,
// webhook ingest, admin edits).

import { createFileRoute } from "@tanstack/react-router";

type SectionKey = "trending" | "latest" | "featured";
const SECTIONS: Record<SectionKey, (sb: any, limit: number, offset: number) => Promise<any[]>> = {
  trending: async (sb, limit, offset) => {
    const { data } = await sb
      .from("master_titles")
      .select("id, slug, title, poster_url, release_year, rating, category, view_count")
      .eq("status", "published")
      .eq("is_trending", true)
      .order("view_count", { ascending: false })
      .order("id", { ascending: true })
      .range(offset, offset + limit - 1);
    return data ?? [];
  },
  latest: async (sb, limit, offset) => {
    const { data } = await sb
      .from("master_titles")
      .select("id, slug, title, poster_url, release_year, rating, category, created_at")
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(offset, offset + limit - 1);
    return data ?? [];
  },
  featured: async (sb, limit, offset) => {
    const { data } = await sb
      .from("master_titles")
      .select("id, slug, title, poster_url, release_year, rating, category, updated_at")
      .eq("status", "published")
      .eq("is_featured", true)
      .order("updated_at", { ascending: false })
      .order("id", { ascending: true })
      .range(offset, offset + limit - 1);
    return data ?? [];
  },
};

function isSectionKey(k: string): k is SectionKey {
  return k === "trending" || k === "latest" || k === "featured";
}

export const Route = createFileRoute("/api/public/section/$key")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const { consumeRateLimit, rateLimitHeaders, clientIpFromHeaders } =
          await import("@/lib/rate-limit.server");
        const { cached, getCacheVersion } = await import("@/lib/cache.server");

        // Per-IP limit: 30 requests / 10s. Bursts above this -> 429.
        const ip = clientIpFromHeaders(request.headers);
        const rl = await consumeRateLimit({
          key: `section:${params.key}:${ip}`,
          limit: 30,
          windowSec: 10,
        });
        const rlHeaders = rateLimitHeaders(rl);

        if (!isSectionKey(params.key)) {
          return new Response(JSON.stringify({ error: "unknown_section" }), {
            status: 404,
            headers: { "content-type": "application/json", ...rlHeaders },
          });
        }

        if (!rl.allowed) {
          return new Response(
            JSON.stringify({ error: "rate_limited", retryAfterSec: rl.retryAfterSec }),
            { status: 429, headers: { "content-type": "application/json", ...rlHeaders } },
          );
        }

        const url = new URL(request.url);
        const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "60", 10) || 60, 1), 120);
        const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);
        const page = Math.floor(offset / limit) + 1;

        try {
          const cacheVersion = await getCacheVersion();
          const items = await cached(
            "section",
            `${params.key}:${limit}:${offset}`,
            30_000,
            async () => {
              const { createClient } = await import("@supabase/supabase-js");
              const sb = createClient(
                process.env.SUPABASE_URL!,
                process.env.SUPABASE_PUBLISHABLE_KEY!,
                { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
              );
              return SECTIONS[params.key as SectionKey](sb, limit, offset);
            },
          );

          return new Response(
            JSON.stringify({
              ok: true,
              section: params.key,
              cacheVersion,
              pagination: {
                limit,
                offset,
                page,
                count: items.length,
                hasMore: items.length === limit,
              },
              items,
              ids: items.map((r: any) => r.id),
            }),
            {
              status: 200,
              headers: {
                "content-type": "application/json; charset=utf-8",
                "cache-control": "public, max-age=15, s-maxage=30",
                ...rlHeaders,
              },
            },
          );
        } catch (e: any) {
          return new Response(
            JSON.stringify({ error: "internal_error", message: e?.message ?? "error" }),
            { status: 500, headers: { "content-type": "application/json", ...rlHeaders } },
          );
        }
      },
    },
  },
});
