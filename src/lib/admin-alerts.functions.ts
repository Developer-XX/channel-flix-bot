// Admin alerts + cron job status (server fns).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminAccess } from "@/lib/admin-auth";

export const listAdminAlerts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: open }, { data: recent }, { data: cron }] = await Promise.all([
      supabaseAdmin
        .from("admin_alerts")
        .select("*")
        .is("resolved_at", null)
        .order("severity", { ascending: false })
        .order("last_seen_at", { ascending: false })
        .limit(100),
      supabaseAdmin
        .from("admin_alerts")
        .select("id, kind, severity, subject, last_seen_at, resolved_at, acknowledged_at")
        .not("resolved_at", "is", null)
        .order("resolved_at", { ascending: false })
        .limit(30),
      supabaseAdmin
        .from("cron_job_status")
        .select("*")
        .order("job_name", { ascending: true }),
    ]);

    const now = Date.now();
    const cronEnriched = ((cron as any[]) ?? []).map((c) => {
      const lastRunMs = c.last_run_at ? new Date(c.last_run_at).getTime() : null;
      const ageSec = lastRunMs ? Math.round((now - lastRunMs) / 1000) : null;
      const isLagging = ageSec !== null && ageSec > c.expected_interval_seconds * 3;
      return { ...c, ageSec, isLagging };
    });

    return {
      open: open ?? [],
      recent: recent ?? [],
      cron: cronEnriched,
      hasErrors: ((open as any[]) ?? []).some((a) => a.severity === "error"),
    };
  });

export const ackAdminAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), resolve: z.boolean().optional() }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: Record<string, unknown> = {
      acknowledged_at: new Date().toISOString(),
      acknowledged_by: context.userId,
    };
    if (data.resolve) patch.resolved_at = new Date().toISOString();
    const { error } = await supabaseAdmin.from("admin_alerts").update(patch).eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });
