import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminAccess } from "@/lib/admin-auth";

// Audit log filtered to /admin/settings changes.
export const listSettingsAuditLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ limit: z.number().int().min(1).max(500).optional() }).parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("admin_audit_log")
      .select("id, actor_user_id, actor_email, action, status, metadata, created_at")
      .eq("action", "settings.update")
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 100);
    if (error) throw error;
    return (rows ?? []).map((r: any) => ({
      id: r.id,
      createdAt: r.created_at,
      actorUserId: r.actor_user_id,
      actorEmail: r.actor_email,
      status: r.status,
      key: r.metadata?.key ?? null,
      isSecret: !!r.metadata?.isSecret,
      hasValue: !!r.metadata?.hasValue,
    }));
  });

// Ingestion deduplication statistics. Reports total telegram_ingest rows,
// how many carry an idempotency_key, the count of distinct keys (so the
// difference equals "would-be duplicates" that were collapsed), and a
// roll-up of recent resync runs from admin_audit_log.
export const getIngestionDedupStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [total, withKey, resync] = await Promise.all([
      supabaseAdmin.from("telegram_ingest").select("id", { count: "exact", head: true }),
      supabaseAdmin
        .from("telegram_ingest")
        .select("id", { count: "exact", head: true })
        .not("idempotency_key", "is", null),
      supabaseAdmin
        .from("admin_audit_log")
        .select("id, created_at, actor_email, metadata, status")
        .eq("action", "telegram.resync_channels")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    const recentRuns = (resync.data ?? []).map((r: any) => ({
      id: r.id,
      createdAt: r.created_at,
      actorEmail: r.actor_email,
      status: r.status,
      scanned: Number(r.metadata?.scanned ?? 0),
      metadataUpdated: Number(r.metadata?.metadataUpdated ?? 0),
      backfillProcessed: Number(r.metadata?.backfillProcessed ?? 0),
      channelCount: Array.isArray(r.metadata?.channelIds) ? r.metadata.channelIds.length : 0,
    }));

    const totals = recentRuns.reduce(
      (acc, r) => {
        acc.scanned += r.scanned;
        acc.metadataUpdated += r.metadataUpdated;
        acc.backfillProcessed += r.backfillProcessed;
        return acc;
      },
      { scanned: 0, metadataUpdated: 0, backfillProcessed: 0 },
    );
    // Skipped-due-to-idempotency on resync == scanned rows that did NOT need
    // a metadata patch (already complete) and were not newly inserted by the
    // backfill loop. This is the practical "dedupe avoided rework" number.
    const resyncSkipped = Math.max(0, totals.scanned - totals.metadataUpdated);

    return {
      ingest: {
        totalRows: total.count ?? 0,
        withIdempotencyKey: withKey.count ?? 0,
        missingIdempotencyKey: Math.max(0, (total.count ?? 0) - (withKey.count ?? 0)),
      },
      resyncTotals: {
        runs: recentRuns.length,
        scanned: totals.scanned,
        metadataUpdated: totals.metadataUpdated,
        backfillProcessed: totals.backfillProcessed,
        skippedByIdempotency: resyncSkipped,
      },
      recentRuns,
    };
  });

// Per-Telegram-channel breakdown of promoted vs unmatched vs demoted files
// over the last 24h. "Promoted" + "unmatched" come from telegram_ingest
// (current state of rows ingested in the window); "demoted" comes from
// match_audit_log entries with decision='demoted' joined back to the
// ingest row to recover its channel.
export const getChannelMatchBreakdown24h = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [channelsRes, ingestRes, demotedRes] = await Promise.all([
      supabaseAdmin.from("telegram_channels").select("id, name, username"),
      supabaseAdmin
        .from("telegram_ingest")
        .select("channel_id, match_status")
        .gte("created_at", since),
      supabaseAdmin
        .from("match_audit_log")
        .select("telegram_ingest_id, telegram_ingest:telegram_ingest_id(channel_id)")
        .eq("decision", "demoted")
        .gte("attempt_at", since),
    ]);

    const channels = channelsRes.data ?? [];
    const ingest = ingestRes.data ?? [];
    const demoted = demotedRes.data ?? [];

    type Bucket = { promoted: number; unmatched: number; matched: number; demoted: number; total: number };
    const byChannel = new Map<string, Bucket>();
    const ensure = (id: string | null) => {
      const key = id ?? "_unknown";
      if (!byChannel.has(key)) byChannel.set(key, { promoted: 0, unmatched: 0, matched: 0, demoted: 0, total: 0 });
      return byChannel.get(key)!;
    };
    for (const r of ingest) {
      const b = ensure((r as any).channel_id);
      b.total++;
      const s = (r as any).match_status as string | null;
      if (s === "promoted") b.promoted++;
      else if (s === "matched") b.matched++;
      else b.unmatched++;
    }
    for (const r of demoted) {
      const cid = (r as any).telegram_ingest?.channel_id ?? null;
      ensure(cid).demoted++;
    }

    const rows = Array.from(byChannel.entries()).map(([cid, b]) => {
      const meta = channels.find((c: any) => c.id === cid);
      return {
        channelId: cid,
        label: meta ? (meta.name || meta.username || cid) : "(unknown)",
        username: (meta as any)?.username ?? null,
        ...b,
      };
    }).sort((a, b) => b.total - a.total);

    const totals = rows.reduce(
      (acc, r) => {
        acc.promoted += r.promoted; acc.matched += r.matched;
        acc.unmatched += r.unmatched; acc.demoted += r.demoted; acc.total += r.total;
        return acc;
      },
      { promoted: 0, matched: 0, unmatched: 0, demoted: 0, total: 0 },
    );

    return { since, rows, totals };
  });

