// Aggregated analytics for the admin dashboard.
// All counts are served by the authenticated supabase client (RLS as the admin user)
// because the admin user has SELECT policies on the relevant tables.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminAccess } from "@/lib/admin-auth";

export type AdminAnalytics = {
  generatedAt: string;
  users: {
    total: number;
    activeToday: number;
    active7d: number;
    active30d: number;
    newToday: number;
    new7d: number;
  };
  downloads: {
    total: number;
    today: number;
    last7d: number;
    last30d: number;
    deliveredToday: number;
    failedToday: number;
  };
  catalog: {
    titles: number;
    published: number;
    draft: number;
    archived: number;
    files: number;
    pendingRequests: number;
  };
  topViewed: Array<{ id: string; title: string; slug: string; poster_url: string | null; view_count: number }>;
  topDownloaded: Array<{ id: string; title: string; slug: string; poster_url: string | null; download_count: number }>;
  trending: Array<{
    title_id: string;
    title: string;
    slug: string;
    poster_url: string | null;
    score: number;
    rank: number;
  }>;
  downloadsByDay: Array<{ day: string; count: number }>;
  blockedBrowsing: {
    publicBrowsingEnabled: boolean;
    today: number;
    last7d: number;
    last30d: number;
    byReason: Array<{ reason: string; count: number }>;
    recent: Array<{ id: string; created_at: string; reason: string; slug: string | null; path: string | null; toggle_on: boolean }>;
  };
};

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function startOfTodayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export const getAdminAnalytics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminAnalytics> => {
    await requireAdminAccess(context);
    const sb = context.supabase;

    const todayISO = startOfTodayISO();
    const d7 = isoDaysAgo(7);
    const d30 = isoDaysAgo(30);

    // Counts
    const [
      usersTotal,
      newToday,
      new7d,
      titlesTotal,
      titlesPublished,
      titlesDraft,
      titlesArchived,
      filesTotal,
      pendingReqs,
      dlTotal,
      dlToday,
      dl7d,
      dl30d,
      deliveredToday,
      failedToday,
    ] = await Promise.all([
      sb.from("profiles").select("id", { count: "exact", head: true }),
      sb.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", todayISO),
      sb.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", d7),
      sb.from("master_titles").select("id", { count: "exact", head: true }),
      sb.from("master_titles").select("id", { count: "exact", head: true }).eq("status", "published"),
      sb.from("master_titles").select("id", { count: "exact", head: true }).eq("status", "draft"),
      sb.from("master_titles").select("id", { count: "exact", head: true }).eq("status", "archived"),
      sb.from("media_files").select("id", { count: "exact", head: true }),
      sb.from("content_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
      sb.from("download_logs").select("id", { count: "exact", head: true }),
      sb.from("download_logs").select("id", { count: "exact", head: true }).gte("created_at", todayISO),
      sb.from("download_logs").select("id", { count: "exact", head: true }).gte("created_at", d7),
      sb.from("download_logs").select("id", { count: "exact", head: true }).gte("created_at", d30),
      sb
        .from("download_logs")
        .select("id", { count: "exact", head: true })
        .gte("created_at", todayISO)
        .eq("delivery_status", "delivered"),
      sb
        .from("download_logs")
        .select("id", { count: "exact", head: true })
        .gte("created_at", todayISO)
        .eq("delivery_status", "failed"),
    ]);

    const firstErr =
      usersTotal.error ??
      titlesTotal.error ??
      filesTotal.error ??
      dlTotal.error ??
      pendingReqs.error;
    if (firstErr) throw firstErr;

    // DAU via distinct user_id in download_logs in window — light enough at small scale.
    const [{ data: dauTodayRows }, { data: dau7dRows }, { data: dau30dRows }] = await Promise.all([
      sb.from("download_logs").select("user_id").gte("created_at", todayISO).not("user_id", "is", null),
      sb.from("download_logs").select("user_id").gte("created_at", d7).not("user_id", "is", null),
      sb.from("download_logs").select("user_id").gte("created_at", d30).not("user_id", "is", null),
    ]);
    const distinct = (rows: Array<{ user_id: string | null }> | null) =>
      new Set((rows ?? []).map((r) => r.user_id).filter(Boolean)).size;

    // Top titles
    const [{ data: topV }, { data: topD }, { data: trending }] = await Promise.all([
      sb
        .from("master_titles")
        .select("id, title, slug, poster_url, view_count")
        .order("view_count", { ascending: false, nullsFirst: false })
        .limit(10),
      sb
        .from("master_titles")
        .select("id, title, slug, poster_url, download_count")
        .order("download_count", { ascending: false, nullsFirst: false })
        .limit(10),
      sb
        .from("idx_trending")
        .select("title_id, score, rank, master_titles!inner(title, slug, poster_url)")
        .order("rank", { ascending: true })
        .limit(10),
    ]);

    // Downloads by day (last 14 days) — fetch raw then bucket client-side.
    const since14 = isoDaysAgo(14);
    const { data: recent } = await sb
      .from("download_logs")
      .select("created_at")
      .gte("created_at", since14)
      .limit(5000);
    const buckets = new Map<string, number>();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86_400_000);
      d.setHours(0, 0, 0, 0);
      buckets.set(d.toISOString().slice(0, 10), 0);
    }
    for (const row of recent ?? []) {
      const key = String(row.created_at).slice(0, 10);
      if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }

    return {
      generatedAt: new Date().toISOString(),
      users: {
        total: usersTotal.count ?? 0,
        activeToday: distinct(dauTodayRows as Array<{ user_id: string | null }> | null),
        active7d: distinct(dau7dRows as Array<{ user_id: string | null }> | null),
        active30d: distinct(dau30dRows as Array<{ user_id: string | null }> | null),
        newToday: newToday.count ?? 0,
        new7d: new7d.count ?? 0,
      },
      downloads: {
        total: dlTotal.count ?? 0,
        today: dlToday.count ?? 0,
        last7d: dl7d.count ?? 0,
        last30d: dl30d.count ?? 0,
        deliveredToday: deliveredToday.count ?? 0,
        failedToday: failedToday.count ?? 0,
      },
      catalog: {
        titles: titlesTotal.count ?? 0,
        published: titlesPublished.count ?? 0,
        draft: titlesDraft.count ?? 0,
        archived: titlesArchived.count ?? 0,
        files: filesTotal.count ?? 0,
        pendingRequests: pendingReqs.count ?? 0,
      },
      topViewed: (topV ?? []).map((r: any) => ({
        id: r.id,
        title: r.title,
        slug: r.slug,
        poster_url: r.poster_url,
        view_count: r.view_count ?? 0,
      })),
      topDownloaded: (topD ?? []).map((r: any) => ({
        id: r.id,
        title: r.title,
        slug: r.slug,
        poster_url: r.poster_url,
        download_count: r.download_count ?? 0,
      })),
      trending: (trending ?? []).map((r: any) => ({
        title_id: r.title_id,
        title: r.master_titles?.title ?? "",
        slug: r.master_titles?.slug ?? "",
        poster_url: r.master_titles?.poster_url ?? null,
        score: Number(r.score ?? 0),
        rank: Number(r.rank ?? 0),
      })),
      downloadsByDay: Array.from(buckets.entries()).map(([day, count]) => ({ day, count })),
    };
  });
