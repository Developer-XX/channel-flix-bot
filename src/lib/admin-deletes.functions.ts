// Admin-only server functions for inspecting & exporting scheduled message
// deletion targets and for reading rate-limit / cron telemetry recorded by
// the process-message-deletes hook.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminAccess } from "@/lib/admin-auth";

const PreviewInput = z.object({
  /** Cap returned targets (also applies the same cap the cron uses). */
  limit: z.number().int().min(1).max(500).default(50),
  /** When true, include rows whose delete_at is still in the future. */
  includeFuture: z.boolean().default(false),
});

export const previewMessageDeletes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => PreviewInput.parse(d))
  .handler(async ({ data, context }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let q = supabaseAdmin
      .from("scheduled_message_deletes")
      .select("id, chat_id, message_id, delete_at, attempts, last_error, done_at, created_at")
      .is("done_at", null)
      .order("delete_at", { ascending: true })
      .limit(data.limit);

    if (!data.includeFuture) {
      q = q.lte("delete_at", new Date().toISOString());
    }

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const now = Date.now();
    return {
      generated_at: new Date().toISOString(),
      count: (rows ?? []).length,
      targets: (rows ?? []).map((r) => ({
        id: r.id,
        chat_id: r.chat_id,
        message_id: r.message_id,
        delete_at: r.delete_at,
        attempts: r.attempts,
        last_error: r.last_error,
        created_at: r.created_at,
        overdue_seconds: Math.floor((now - new Date(r.delete_at).getTime()) / 1000),
      })),
    };
  });

export const getDeleteCronMetrics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("cron_job_status")
      .select("job_name, last_run_at, last_ok_at, last_error, last_summary, total_runs, total_failures, consecutive_failures")
      .eq("job_name", "process-message-deletes")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ?? null;
  });

// --- Reparse-series cron control ---------------------------------------

const ScheduleInput = z.object({
  enabled: z.boolean(),
  /** Per-run scan cap. */
  limit: z.number().int().min(1).max(2000).default(500),
  /** When true, cron only reports what would change. */
  dryRun: z.boolean().default(false),
});

export const getReparseCronConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("app_settings")
      .select("key, value")
      .in("key", [
        "REPARSE_SERIES_CRON_ENABLED",
        "REPARSE_SERIES_CRON_LIMIT",
        "REPARSE_SERIES_CRON_DRYRUN",
      ]);
    const map = new Map<string, string | null>(
      (data ?? []).map((r: any) => [r.key, r.value]),
    );
    const { data: status } = await supabaseAdmin
      .from("cron_job_status")
      .select("job_name, last_run_at, last_ok_at, last_error, last_summary, total_runs, total_failures")
      .eq("job_name", "reparse-series-cron")
      .maybeSingle();
    return {
      enabled: (map.get("REPARSE_SERIES_CRON_ENABLED") ?? "false").toLowerCase() === "true",
      limit: Number(map.get("REPARSE_SERIES_CRON_LIMIT") ?? "500") || 500,
      dryRun: (map.get("REPARSE_SERIES_CRON_DRYRUN") ?? "false").toLowerCase() === "true",
      status: status ?? null,
    };
  });

export const setReparseCronConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ScheduleInput.parse(d))
  .handler(async ({ data, context }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const rows = [
      { key: "REPARSE_SERIES_CRON_ENABLED", value: data.enabled ? "true" : "false" },
      { key: "REPARSE_SERIES_CRON_LIMIT", value: String(data.limit) },
      { key: "REPARSE_SERIES_CRON_DRYRUN", value: data.dryRun ? "true" : "false" },
    ];
    const { error } = await supabaseAdmin
      .from("app_settings")
      .upsert(rows, { onConflict: "key" });
    if (error) throw new Error(error.message);
    try {
      const { bumpSettingsVersion } = await import("@/lib/runtime-settings.server");
      bumpSettingsVersion();
    } catch {}
    return { ok: true };
  });
