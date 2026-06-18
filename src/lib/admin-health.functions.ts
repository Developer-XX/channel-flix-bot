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
  offset: z.number().int().min(0).optional().default(0),
  fnExport: z.string().optional(),
  userId: z.string().uuid().optional(),
  status: z.number().int().optional(),
  sinceMs: z.number().int().min(0).optional(),
});

export const listAdminErrors = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => ListSchema.parse(input))
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let q = supabaseAdmin
      .from("admin_error_log")
      .select(
        "id, request_id, fn_export, fn_file, user_id, status, error_message, duration_ms, created_at",
        { count: "exact" },
      );
    if (data.fnExport) q = q.eq("fn_export", data.fnExport);
    if (data.userId) q = q.eq("user_id", data.userId);
    if (typeof data.status === "number") q = q.eq("status", data.status);
    if (data.sinceMs && data.sinceMs > 0) {
      const since = new Date(Date.now() - data.sinceMs).toISOString();
      q = q.gte("created_at", since);
    }

    const { data: rows, error, count } = await q
      .order("created_at", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);
    if (error) throw error;
    return { rows: rows ?? [], total: count ?? 0, offset: data.offset, limit: data.limit };
  });

/**
 * Snapshot of the caller's auth state — used by the Admin Diagnostics UI
 * so an admin can confirm the bearer is reaching the server and the
 * has_role lookup succeeds.
 */
export const getAuthDiagnostics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: roles }, { data: profile }] = await Promise.all([
      supabaseAdmin.from("user_roles").select("role").eq("user_id", context.userId),
      supabaseAdmin
        .from("profiles")
        .select("display_name")
        .eq("id", context.userId)
        .maybeSingle(),
    ]);

    const { data: recentAuthErrors } = await supabaseAdmin
      .from("admin_error_log")
      .select("id, fn_export, status, error_message, created_at")
      .eq("user_id", context.userId)
      .in("status", [401, 403])
      .order("created_at", { ascending: false })
      .limit(5);

    const claims = (context.claims ?? null) as { email?: string; exp?: number } | null;
    return {
      userId: context.userId,
      email: claims?.email ?? null,
      displayName: profile?.display_name ?? null,
      roles: (roles ?? []).map((r) => r.role),
      tokenExpiresAt:
        typeof claims?.exp === "number" ? new Date(claims.exp * 1000).toISOString() : null,
      bearerReceived: true,
      recentAuthErrors: recentAuthErrors ?? [],
      serverTime: new Date().toISOString(),
    };
  });
