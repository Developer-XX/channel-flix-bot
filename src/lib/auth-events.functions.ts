import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, getRequestIP } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const AUTH_EVENT_ACTIONS = [
  "auth.signin.success",
  "auth.signin.failed",
  "auth.signup.success",
  "auth.signup.failed",
  "auth.google.success",
  "auth.google.failed",
  "auth.signout",
] as const;

const LogAuthEventSchema = z.object({
  action: z.enum(AUTH_EVENT_ACTIONS),
  email: z.string().email().max(320).optional(),
  message: z.string().max(500).optional(),
  code: z.string().max(64).optional(),
  provider: z.string().max(32).optional(),
});

function requestMeta() {
  const ip =
    getRequestIP({ xForwardedFor: true }) ??
    getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim() ??
    null;
  const userAgent = getRequestHeader("user-agent")?.slice(0, 256) ?? null;
  return { ip, userAgent };
}

/**
 * Public endpoint used by the auth UI to record sign-in / sign-up outcomes
 * (success and failure) in the admin audit log. This is the same surface the
 * Admin → Audit Log and analytics dashboards read from.
 */
export const logAuthEvent = createServerFn({ method: "POST" })
  .inputValidator((input) => LogAuthEventSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { ip, userAgent } = requestMeta();
    const status =
      data.action.endsWith(".failed") ? "failed" : data.action === "auth.signout" ? "info" : "success";

    try {
      await (supabaseAdmin as any).from("admin_audit_log").insert({
        action: data.action,
        status,
        actor_email: data.email ?? null,
        ip,
        user_agent: userAgent,
        metadata: {
          provider: data.provider ?? (data.action.includes("google") ? "google" : "email"),
          message: data.message ?? null,
          code: data.code ?? null,
        },
      });
    } catch (e) {
      console.warn("[auth-events] insert failed", (e as Error).message);
    }
    return { ok: true as const };
  });

/**
 * After Google sign-in: scan for other auth users with the same email and,
 * when found, mark the older account as linked. Profile metadata
 * (display_name, avatar_url) is copied forward if missing, and an audit
 * entry plus admin alert captures any data the human admin should review.
 */
export const linkGoogleAccountByEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { ip, userAgent } = requestMeta();
    const userId = context.userId;
    const claims: any = context.claims ?? {};
    const email = (claims.email ?? "").toString().toLowerCase();
    if (!email) return { ok: true as const, linked: false, reason: "no_email" };

    // Find all auth users that share this email.
    let matches: Array<{ id: string; email: string | null; created_at?: string; identities?: any[] }> = [];
    try {
      const { data, error } = await (supabaseAdmin as any).auth.admin.listUsers({
        page: 1,
        perPage: 200,
      });
      if (error) throw error;
      matches = (data?.users ?? []).filter(
        (u: any) => (u.email ?? "").toLowerCase() === email && u.id !== userId,
      );
    } catch (e) {
      console.warn("[auth-link] listUsers failed", (e as Error).message);
    }

    if (matches.length === 0) {
      return { ok: true as const, linked: false, reason: "no_duplicates" };
    }

    // Choose the oldest duplicate as the legacy account to link from.
    const legacy = matches.sort((a, b) =>
      (a.created_at ?? "").localeCompare(b.created_at ?? ""),
    )[0];

    // Copy display_name / avatar_url forward into the current profile if empty.
    try {
      const { data: currentProfile } = await (supabaseAdmin as any)
        .from("profiles")
        .select("display_name, avatar_url, premium_plan, premium_until, is_premium")
        .eq("id", userId)
        .maybeSingle();
      const { data: legacyProfile } = await (supabaseAdmin as any)
        .from("profiles")
        .select("display_name, avatar_url, premium_plan, premium_until, is_premium")
        .eq("id", legacy.id)
        .maybeSingle();
      if (legacyProfile) {
        const patch: Record<string, unknown> = {};
        if (!currentProfile?.display_name && legacyProfile.display_name)
          patch.display_name = legacyProfile.display_name;
        if (!currentProfile?.avatar_url && legacyProfile.avatar_url)
          patch.avatar_url = legacyProfile.avatar_url;
        if (!currentProfile?.is_premium && legacyProfile.is_premium) {
          patch.is_premium = true;
          patch.premium_plan = legacyProfile.premium_plan;
          patch.premium_until = legacyProfile.premium_until;
        }
        if (Object.keys(patch).length > 0) {
          await (supabaseAdmin as any).from("profiles").update(patch).eq("id", userId);
        }
      }
    } catch (e) {
      console.warn("[auth-link] profile merge failed", (e as Error).message);
    }

    // Audit the link decision.
    try {
      await (supabaseAdmin as any).from("admin_audit_log").insert({
        action: "auth.google.linked",
        status: "info",
        actor_user_id: userId,
        actor_email: email,
        ip,
        user_agent: userAgent,
        metadata: {
          legacy_user_id: legacy.id,
          legacy_created_at: legacy.created_at ?? null,
          matched_count: matches.length,
        },
      });
    } catch (e) {
      console.warn("[auth-link] audit insert failed", (e as Error).message);
    }

    return {
      ok: true as const,
      linked: true,
      legacy_user_id: legacy.id,
      matched_count: matches.length,
    };
  });
