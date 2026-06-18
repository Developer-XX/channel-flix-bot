// CSV export for blocked-browsing analytics. Admin-only.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminAccess } from "@/lib/admin-auth";

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export const exportBlockedBrowsingCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { windowDays?: number } | undefined) => ({
    windowDays: Math.max(1, Math.min(90, Number(input?.windowDays ?? 30))),
  }))
  .handler(async ({ data, context }) => {
    await requireAdminAccess(context);
    const sb = context.supabase;
    const since = isoDaysAgo(data.windowDays);

    const { data: rows, error } = await sb
      .from("blocked_browsing_log")
      .select("id, created_at, reason, slug, path, toggle_on, user_agent")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(50_000);
    if (error) throw error;

    // Detail sheet.
    const header = ["id", "created_at", "reason", "slug", "path", "toggle_on", "user_agent"];
    const detail = [header.join(",")];
    for (const r of rows ?? []) {
      detail.push(
        [r.id, r.created_at, r.reason, r.slug, r.path, r.toggle_on, r.user_agent]
          .map(csvEscape)
          .join(","),
      );
    }

    // By-reason summary.
    const byReason = new Map<string, number>();
    for (const r of rows ?? []) {
      byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + 1);
    }
    const summary = [
      "# blocked_browsing summary",
      `# window_days,${data.windowDays}`,
      `# total,${rows?.length ?? 0}`,
      "",
      "reason,count",
      ...Array.from(byReason.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([reason, count]) => `${csvEscape(reason)},${count}`),
      "",
    ];

    return {
      filename: `blocked-browsing-${data.windowDays}d-${new Date().toISOString().slice(0, 10)}.csv`,
      csv: [...summary, ...detail].join("\n"),
      total: rows?.length ?? 0,
      windowDays: data.windowDays,
    };
  });
