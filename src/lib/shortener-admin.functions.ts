// Admin: shortener performance report + rotation config + probe.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminAccess } from "@/lib/admin-auth";
import {
  buildShortenerReport,
  type ShortenerHealthSample,
  type ShortenerConfigRow,
} from "@/lib/shortener-stats";

export const getShortenerReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const since30 = new Date(Date.now() - 30 * 86400_000).toISOString();

    const [{ data: configs, error: cfgErr }, { data: samples, error: sampleErr }] =
      await Promise.all([
        supabaseAdmin.from("shortener_configs").select("*").order("priority", { ascending: true }),
        // NOTE: column on shortener_health_log is `checked_at`, not `created_at`.
        // Selecting `created_at` here historically caused a silent empty result
        // and zeroed-out attempts/success rates in the admin UI. See
        // src/lib/__tests__/shortener-stats.test.ts.
        supabaseAdmin
          .from("shortener_health_log")
          .select("provider, ok, latency_ms, checked_at, error")
          .gte("checked_at", since30)
          .order("checked_at", { ascending: false })
          .limit(5000),
      ]);

    if (cfgErr) throw new Error(`shortener_configs: ${cfgErr.message}`);
    if (sampleErr) throw new Error(`shortener_health_log: ${sampleErr.message}`);

    const providers = buildShortenerReport(
      (configs as ShortenerConfigRow[]) ?? [],
      (samples as ShortenerHealthSample[]) ?? [],
    );
    return { providers, sampleCount: samples?.length ?? 0 };
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
