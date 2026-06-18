// User-facing download history + admin-side download/queue inspection.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminAccess } from "@/lib/admin-auth";

export const getMyDownloadHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getSettingNumber } = await import("@/lib/runtime-settings.server");

    const [{ data: logs }, { data: queue }, { data: counts }] = await Promise.all([
      supabaseAdmin
        .from("download_logs")
        .select(
          "id, file_id, title_id, delivery_status, delivery_error, delivered_at, created_at, attempt_count, idempotency_key, media_files(file_name, quality, resolution), master_titles(title, slug)",
        )
        .eq("user_id", context.userId)
        .order("created_at", { ascending: false })
        .limit(100),
      supabaseAdmin
        .from("download_send_queue")
        .select("idempotency_key, status, attempts, last_error, message_id, sent_at, next_attempt_at, file_id")
        .eq("user_id", context.userId)
        .order("created_at", { ascending: false })
        .limit(200),
      supabaseAdmin
        .from("delivery_attempts")
        .select("media_file_id, reused_from_cooldown")
        .eq("user_id", context.userId),
    ]);

    const cooldownSec = Math.max(1, Math.min(60, await getSettingNumber("DOWNLOAD_RESEND_COOLDOWN_SECONDS", 8)));

    // Resend counts per file (number of delivery_attempts rows).
    const resendCounts = new Map<string, number>();
    const reusedCounts = new Map<string, number>();
    for (const a of (counts as any[]) ?? []) {
      resendCounts.set(a.media_file_id, (resendCounts.get(a.media_file_id) ?? 0) + 1);
      if (a.reused_from_cooldown) {
        reusedCounts.set(a.media_file_id, (reusedCounts.get(a.media_file_id) ?? 0) + 1);
      }
    }

    const queueByKey = new Map<string, any>();
    for (const q of (queue as any[]) ?? []) queueByKey.set(q.idempotency_key, q);

    const rows = ((logs as any[]) ?? []).map((l) => {
      const q = l.idempotency_key ? queueByKey.get(l.idempotency_key) : null;
      const lastSentAt = q?.sent_at ?? l.delivered_at ?? null;
      const cooldownRemainingMs = lastSentAt
        ? Math.max(0, cooldownSec * 1000 - (Date.now() - new Date(lastSentAt).getTime()))
        : 0;
      return {
        id: l.id,
        fileId: l.file_id,
        titleId: l.title_id,
        title: l.master_titles?.title ?? null,
        titleSlug: l.master_titles?.slug ?? null,
        fileName: l.media_files?.file_name ?? null,
        quality: l.media_files?.quality ?? null,
        resolution: l.media_files?.resolution ?? null,
        status: l.delivery_status,
        error: l.delivery_error,
        createdAt: l.created_at,
        deliveredAt: l.delivered_at,
        attemptCount: l.attempt_count ?? 0,
        resendCount: resendCounts.get(l.file_id) ?? 0,
        reusedCount: reusedCounts.get(l.file_id) ?? 0,
        queueStatus: q?.status ?? null,
        queueLastError: q?.last_error ?? null,
        messageId: q?.message_id ?? null,
        nextAttemptAt: q?.next_attempt_at ?? null,
        cooldownRemainingMs,
      };
    });

    return { rows, cooldownSec };
  });

// Admin: paginated audit log feed.
const AuditFilter = z.object({
  limit: z.number().int().min(1).max(200).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
  action: z.string().optional(),
  actorUserId: z.string().uuid().optional(),
  sinceMs: z.number().int().min(0).optional(),
  search: z.string().max(120).optional(),
});

export const getAdminAuditLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AuditFilter.parse(d))
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("admin_audit_log")
      .select("id, actor_user_id, actor_email, action, status, ip, user_agent, metadata, created_at", { count: "exact" });
    if (data.action) q = q.eq("action", data.action);
    if (data.actorUserId) q = q.eq("actor_user_id", data.actorUserId);
    if (data.sinceMs) q = q.gte("created_at", new Date(Date.now() - data.sinceMs).toISOString());
    if (data.search) q = q.ilike("action", `%${data.search}%`);
    const { data: rows, count, error } = await q
      .order("created_at", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);
    if (error) throw error;
    // Distinct action list for the filter dropdown.
    const { data: distinctRows } = await supabaseAdmin
      .from("admin_audit_log")
      .select("action")
      .order("created_at", { ascending: false })
      .limit(500);
    const actions = Array.from(new Set(((distinctRows as any[]) ?? []).map((r) => r.action))).sort();
    return { rows: rows ?? [], total: count ?? 0, offset: data.offset, limit: data.limit, actions };
  });
