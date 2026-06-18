// Admin: shortener performance report + rotation config + probe.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminAccess } from "@/lib/admin-auth";

export const getShortenerReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const since7 = new Date(Date.now() - 7 * 86400_000).toISOString();
    const since30 = new Date(Date.now() - 30 * 86400_000).toISOString();

    const [{ data: configs }, { data: samples }] = await Promise.all([
      supabaseAdmin.from("shortener_configs").select("*").order("priority", { ascending: true }),
      supabaseAdmin
        .from("shortener_health_log")
        .select("provider, ok, latency_ms, created_at, error")
        .gte("created_at", since30)
        .order("created_at", { ascending: false })
        .limit(5000),
    ]);

    type Stats = {
      total7: number; ok7: number; total30: number; ok30: number;
      avgLatency7: number | null; avgLatency30: number | null;
      lastFailure: { at: string; error: string | null } | null;
      lastSample: string | null;
    };
    const stats = new Map<string, Stats>();
    for (const s of (samples as any[]) ?? []) {
      const prev = stats.get(s.provider) ?? {
        total7: 0, ok7: 0, total30: 0, ok30: 0,
        avgLatency7: null, avgLatency30: null,
        lastFailure: null, lastSample: null,
      };
      const created = s.created_at;
      const lat = typeof s.latency_ms === "number" ? s.latency_ms : null;
      prev.total30++;
      if (s.ok) prev.ok30++;
      if (lat != null) prev.avgLatency30 = ((prev.avgLatency30 ?? 0) * (prev.total30 - 1) + lat) / prev.total30;
      if (created >= since7) {
        prev.total7++;
        if (s.ok) prev.ok7++;
        if (lat != null) prev.avgLatency7 = ((prev.avgLatency7 ?? 0) * (prev.total7 - 1) + lat) / prev.total7;
      }
      if (!s.ok && !prev.lastFailure) prev.lastFailure = { at: created, error: s.error ?? null };
      if (!prev.lastSample || created > prev.lastSample) prev.lastSample = created;
      stats.set(s.provider, prev);
    }

    const providers = ((configs as any[]) ?? []).map((c) => {
      const st = stats.get(c.provider) ?? { total7: 0, ok7: 0, total30: 0, ok30: 0, avgLatency7: null, avgLatency30: null, lastFailure: null, lastSample: null };
      return {
        ...c,
        successRate7: st.total7 ? Math.round((st.ok7 / st.total7) * 1000) / 10 : null,
        successRate30: st.total30 ? Math.round((st.ok30 / st.total30) * 1000) / 10 : null,
        avgLatencyMs7: st.avgLatency7 ? Math.round(st.avgLatency7) : null,
        avgLatencyMs30: st.avgLatency30 ? Math.round(st.avgLatency30) : null,
        attempts7: st.total7,
        attempts30: st.total30,
        lastFailure: st.lastFailure,
        lastSample: st.lastSample,
      };
    });
    return { providers };
  });

const ConfigPatch = z.object({
  provider: z.string().min(1).max(64),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  weight: z.number().int().min(0).max(1000).optional(),
  notes: z.string().max(500).nullable().optional(),
});

export const updateShortenerConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ConfigPatch.parse(d))
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { writeAudit } = await import("@/lib/audit.server");
    const patch: {
      enabled?: boolean;
      priority?: number;
      weight?: number;
      notes?: string | null;
      updated_by: string;
    } = { updated_by: context.userId };
    if (data.enabled !== undefined) patch.enabled = data.enabled;
    if (data.priority !== undefined) patch.priority = data.priority;
    if (data.weight !== undefined) patch.weight = data.weight;
    if (data.notes !== undefined) patch.notes = data.notes;
    const { error } = await supabaseAdmin
      .from("shortener_configs")
      .upsert({ provider: data.provider, ...patch }, { onConflict: "provider" });
    if (error) throw error;
    await writeAudit(supabaseAdmin, {
      action: "shortener.config_updated",
      actorUserId: context.userId,
      metadata: { provider: data.provider, patch },
    });
    return { ok: true };
  });
