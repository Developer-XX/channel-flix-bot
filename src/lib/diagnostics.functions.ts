import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Check = {
  code: string;
  status: "ok" | "warn" | "fail";
  detail: string;
};

/**
 * Auth + role diagnostics for the currently signed-in user.
 * Returns precise codes so admins can see exactly why /admin
 * may not be reachable.
 */
export const runAuthDiagnostics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ userId: string; email: string | null; checks: Check[] }> => {
    const checks: Check[] = [];
    const claims = (context.claims ?? {}) as Record<string, unknown>;
    const email = (claims.email as string) ?? null;

    checks.push({
      code: "SESSION_PRESENT",
      status: context.userId ? "ok" : "fail",
      detail: context.userId ? "Bearer token resolved a user id" : "No user id from bearer token",
    });

    const exp = typeof claims.exp === "number" ? (claims.exp as number) : null;
    const iat = typeof claims.iat === "number" ? (claims.iat as number) : null;
    const now = Math.floor(Date.now() / 1000);
    if (exp) {
      const secs = exp - now;
      checks.push({
        code: "JWT_NOT_EXPIRED",
        status: secs > 0 ? "ok" : "fail",
        detail: secs > 0 ? `Expires in ${secs}s` : `Expired ${-secs}s ago`,
      });
      checks.push({
        code: "JWT_EXPIRES_IN",
        status: secs > 300 ? "ok" : "warn",
        detail: `${secs}s remaining (iat=${iat ?? "?"})`,
      });
    } else {
      checks.push({ code: "JWT_NOT_EXPIRED", status: "warn", detail: "No exp claim found" });
    }

    checks.push({
      code: "JWT_EMAIL_CLAIM",
      status: email ? "ok" : "warn",
      detail: email ? email : "No email claim in JWT",
    });

    // Profile row
    const { data: profile, error: profileErr } = await context.supabase
      .from("profiles")
      .select("id, display_name")
      .eq("id", context.userId)
      .maybeSingle();
    checks.push({
      code: "PROFILE_ROW_PRESENT",
      status: profile ? "ok" : profileErr ? "fail" : "warn",
      detail: profile
        ? `display_name=${profile.display_name ?? "(null)"}`
        : profileErr
          ? `profiles read error: ${profileErr.message}`
          : "No profile row — handle_new_user trigger may not have fired",
    });

    // Roles
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles, error: rolesErr } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (rolesErr) {
      checks.push({ code: "ROLES_QUERY", status: "fail", detail: rolesErr.message });
    } else {
      const list = (roles ?? []).map((r) => r.role);
      checks.push({
        code: "ROLE_ADMIN",
        status: list.includes("admin") ? "ok" : "fail",
        detail: list.length ? `Roles: ${list.join(", ")}` : "No roles assigned",
      });
    }

    // has_role RPC parity
    const { data: hasAdmin, error: rpcErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    checks.push({
      code: "HAS_ROLE_RPC",
      status: rpcErr ? "fail" : hasAdmin ? "ok" : "warn",
      detail: rpcErr ? rpcErr.message : `has_role(admin) = ${hasAdmin}`,
    });

    // Total admins in system
    const { count: adminCount } = await supabaseAdmin
      .from("user_roles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");
    checks.push({
      code: "ADMIN_EXISTS_GLOBAL",
      status: (adminCount ?? 0) > 0 ? "ok" : "warn",
      detail: `${adminCount ?? 0} admin role row(s) in system`,
    });

    return { userId: context.userId, email, checks };
  });

/**
 * Returns sync trace rows for a title (admin only).
 */
export const getSyncTrace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { titleId?: string; runId?: string; limit?: number }) => input)
  .handler(async ({ context, data }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    let q = context.supabase
      .from("sync_trace_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(Math.min(data.limit ?? 500, 2000));
    if (data.titleId) q = q.eq("title_id", data.titleId);
    if (data.runId) q = q.eq("run_id", data.runId);
    const { data: rows, error } = await q;
    if (error) throw error;
    return rows ?? [];
  });
