// Recent delivery audit log for the admin analytics dashboard. Reads
// download_logs (which we now write to on every download attempt — gated,
// failed, or delivered) and returns a paginated, filterable view plus a
// short summary of the most common failure reasons in the last 24h.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminAccess } from "@/lib/admin-auth";

export type DeliveryAuditRow = {
  id: string;
  created_at: string;
  user_id: string | null;
  file_id: string | null;
  title_id: string | null;
  delivery_status: string | null;
  delivery_error: string | null;
  failure_reason: string | null;
  verification_status: string | null;
  shortener_used: string | null;
  category: string | null;
  force_join_required: boolean;
  force_join_status: string | null;
  force_join_channels: Array<{ id: string; title: string; status: string; chatId?: string }> | null;
  attempt_count: number | null;
};

export type DeliveryAuditSummary = {
  total24h: number;
  delivered24h: number;
  blocked24h: number;
  failed24h: number;
  forceJoinBlocked24h: number;
  topReasons: Array<{ reason: string; count: number }>;
};

export const getDeliveryAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      limit: z.number().int().min(1).max(200).default(50),
      status: z.enum(["all", "delivered", "blocked", "failed"]).default("all"),
    }).parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const sb = context.supabase;
    const since24 = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    let q = sb
      .from("download_logs")
      .select("id, created_at, user_id, file_id, title_id, delivery_status, delivery_error, failure_reason, verification_status, shortener_used, category, force_join_required, force_join_status, force_join_channels, attempt_count")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.status === "delivered") q = q.eq("delivery_status", "delivered");
    else if (data.status === "blocked") q = q.eq("delivery_status", "blocked");
    else if (data.status === "failed") q = q.not("delivery_status", "in", "(delivered,blocked)");

    const [rowsRes, statsRes] = await Promise.all([
      q,
      sb
        .from("download_logs")
        .select("delivery_status, failure_reason, force_join_required, force_join_status")
        .gte("created_at", since24)
        .limit(5000),
    ]);
    if (rowsRes.error) throw rowsRes.error;

    const stats = (statsRes.data ?? []) as Array<{
      delivery_status: string | null;
      failure_reason: string | null;
      force_join_required: boolean | null;
      force_join_status: string | null;
    }>;
    let delivered24h = 0;
    let blocked24h = 0;
    let failed24h = 0;
    let forceJoinBlocked24h = 0;
    const reasonCount = new Map<string, number>();
    for (const r of stats) {
      if (r.delivery_status === "delivered") delivered24h++;
      else if (r.delivery_status === "blocked") blocked24h++;
      else failed24h++;
      if (r.force_join_required && r.force_join_status === "not_joined") forceJoinBlocked24h++;
      const reason = r.failure_reason ?? (r.delivery_status === "delivered" ? null : r.delivery_status);
      if (reason) reasonCount.set(reason, (reasonCount.get(reason) ?? 0) + 1);
    }
    const topReasons = Array.from(reasonCount.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    const summary: DeliveryAuditSummary = {
      total24h: stats.length,
      delivered24h,
      blocked24h,
      failed24h,
      forceJoinBlocked24h,
      topReasons,
    };

    return {
      rows: (rowsRes.data ?? []) as DeliveryAuditRow[],
      summary,
    };
  });
