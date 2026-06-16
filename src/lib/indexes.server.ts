// Rebuilds the derived website index tables (latest, trending, search) and
// bumps the global cache_version so client query keys revalidate.

import type { SupabaseClient } from "@supabase/supabase-js";

export async function bumpCacheVersion(
  supabase: SupabaseClient<any, any, any>,
): Promise<number> {
  const { data: cur } = await supabase
    .from("telegram_bot_state")
    .select("cache_version")
    .eq("id", "global")
    .maybeSingle();
  const next = (cur?.cache_version ?? 1) + 1;
  await supabase
    .from("telegram_bot_state")
    .upsert({ id: "global", cache_version: next }, { onConflict: "id" });
  return next;
}

export async function rebuildIndexes(
  supabase: SupabaseClient<any, any, any>,
): Promise<{ latest: number; trending: number; search: number; cacheVersion: number }> {
  // 1) latest releases — top 50 newly indexed active files
  await supabase.from("idx_latest_releases").delete().neq("media_file_id", "00000000-0000-0000-0000-000000000000");
  const { data: latestRows } = await supabase
    .from("media_files")
    .select("id, title_id, created_at")
    .eq("is_active", true)
    .not("title_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(50);
  let latestCount = 0;
  if (latestRows?.length) {
    const payload = latestRows.map((r: any, i: number) => ({
      media_file_id: r.id,
      title_id: r.title_id,
      promoted_at: r.created_at,
      rank: i + 1,
    }));
    await supabase.from("idx_latest_releases").insert(payload);
    latestCount = payload.length;
  }

  // 2) trending — last 7d download counts per title
  await supabase.from("idx_trending").delete().neq("title_id", "00000000-0000-0000-0000-000000000000");
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: dl } = await supabase
    .from("download_logs")
    .select("title_id")
    .gte("created_at", sevenDaysAgo)
    .not("title_id", "is", null)
    .limit(10000);
  const counts = new Map<string, number>();
  for (const row of dl ?? []) {
    const id = (row as any).title_id as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const trendingSorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 100);
  let trendingCount = 0;
  if (trendingSorted.length) {
    const payload = trendingSorted.map(([tid, c], i) => ({
      title_id: tid,
      score: c,
      download_count_7d: c,
      rank: i + 1,
    }));
    await supabase.from("idx_trending").insert(payload);
    trendingCount = payload.length;
  }

  // 3) search — every published title (searchable tsvector is generated from
  // searchable_text by Postgres)
  await supabase.from("idx_search").delete().neq("title_id", "00000000-0000-0000-0000-000000000000");
  const { data: titles } = await supabase
    .from("master_titles")
    .select("id, title, slug, category, release_year, poster_url, original_title, overview, genres")
    .eq("status", "published")
    .limit(20000);
  let searchCount = 0;
  if (titles?.length) {
    const payload = titles.map((t: any) => ({
      title_id: t.id,
      title: t.title,
      slug: t.slug,
      category: t.category,
      release_year: t.release_year,
      poster_url: t.poster_url,
      searchable_text: [t.title, t.original_title, t.overview, ...(t.genres ?? [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase(),
    }));
    for (let i = 0; i < payload.length; i += 500) {
      await supabase.from("idx_search").insert(payload.slice(i, i + 500) as any);
    }
    searchCount = payload.length;
  }

  const cacheVersion = await bumpCacheVersion(supabase);
  await supabase
    .from("telegram_bot_state")
    .upsert({ id: "global", indexes_rebuilt_at: new Date().toISOString() }, { onConflict: "id" });

  return { latest: latestCount, trending: trendingCount, search: searchCount, cacheVersion };
}
