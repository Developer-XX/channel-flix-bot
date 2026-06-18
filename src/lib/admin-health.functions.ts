import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminAccess } from "@/lib/admin-auth";

/**
 * Admin Health Check: probes the registered server functions an admin
 * panel needs and returns ok/fail for each, plus build metadata.
 * Used by /admin/health to surface stale-bundle or missing-fn issues.
 */
export const getAdminHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminAccess(context);

    const { BUILD_ID } = await import("@/build-id");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Database probe.
    let dbOk = true;
    let dbError: string | null = null;
    try {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .select("id", { count: "exact", head: true });
      if (error) {
        dbOk = false;
        dbError = error.message;
      }
    } catch (e) {
      dbOk = false;
      dbError = e instanceof Error ? e.message : String(e);
    }

    // Recent error counts (last 24h, last 1h).
    const since24 = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const since1 = new Date(Date.now() - 3600 * 1000).toISOString();
    const [{ count: errors24h }, { count: errors1h }] = await Promise.all([
      supabaseAdmin
        .from("admin_error_log")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since24),
      supabaseAdmin
        .from("admin_error_log")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since1),
    ]);

    // Required env / secrets check (names only — never values).
    const requiredSecrets = [
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_PUBLISHABLE_KEY",
      "LOVABLE_API_KEY",
      "TELEGRAM_BOT_TOKEN",
    ];
    const secretsStatus = requiredSecrets.map((name) => ({
      name,
      present: Boolean(process.env[name]),
    }));

    return {
      ok: dbOk,
      buildId: BUILD_ID,
      runtime: {
        nodeVersion: typeof process !== "undefined" ? process.version : null,
        uptimeSec:
          typeof process !== "undefined" && process.uptime
            ? Math.round(process.uptime())
            : null,
      },
      database: { ok: dbOk, error: dbError },
      errorCounts: {
        last24h: errors24h ?? 0,
        last1h: errors1h ?? 0,
      },
      secrets: secretsStatus,
      timestamp: new Date().toISOString(),
    };
  });

const ListSchema = z.object({
  limit: z.number().int().min(1).max(200).optional().default(50),
  fnExport: z.string().optional(),
});

export const listAdminErrors = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => ListSchema.parse(input))
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let query = supabaseAdmin
      .from("admin_error_log")
      .select("id, request_id, fn_export, fn_file, user_id, status, error_message, duration_ms, created_at")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.fnExport) query = query.eq("fn_export", data.fnExport);
    const { data: rows, error } = await query;
    if (error) throw error;
    return { rows: rows ?? [] };
  });
