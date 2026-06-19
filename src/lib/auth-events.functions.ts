import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, getRequestIP } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminAccess } from "@/lib/admin-auth";

const AUTH_EVENT_ACTIONS = [
  "auth.signin.success",
  "auth.signin.failed",
  "auth.signup.success",
  "auth.signup.failed",
  "auth.google.success",
  "auth.google.failed",
  "auth.google.linked",
  "auth.signout",
] as const;

// Structured failure-reason vocabulary used by analytics breakdowns.
export const AUTH_FAILURE_REASONS = [
  "invalid_credentials",
  "invalid_token",
  "expired_session",
  "network_error",
  "provider_error",
  "rate_limited",
  "bot_protection",
  "session_missing",
  "email_taken",
  "validation_error",
  "unknown",
] as const;
export type AuthFailureReason = (typeof AUTH_FAILURE_REASONS)[number];

const LogAuthEventSchema = z.object({
  action: z.enum(AUTH_EVENT_ACTIONS),
  email: z.string().email().max(320).optional(),
  message: z.string().max(500).optional(),
  code: z.string().max(64).optional(),
  provider: z.string().max(32).optional(),
  failure_reason: z.enum(AUTH_FAILURE_REASONS).optional(),
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
          failure_reason: data.failure_reason ?? null,
        },
      });
    } catch (e) {
      console.warn("[auth-events] insert failed", (e as Error).message);
    }
    return { ok: true as const };
  });

/**
 * After Google sign-in: resolve account-linking conflicts by inspecting all
 * auth users that share this email and picking a canonical legacy account.
 *
 * Resolution rules:
 *  - none           — no other users with this email; nothing to do.
 *  - linked_single  — exactly one other user; copy missing profile fields forward.
 *  - linked_oldest  — multiple duplicates; pick the *oldest* and link from it,
 *                     skipping any that already have a Google identity.
 *  - skipped_google — every duplicate already has a Google identity (the user
 *                     is signing into a fresh, distinct identity); record only.
 *  - skipped_error  — listUsers/listIdentities failed; surface in audit only.
 *
 * The full decision (including all candidates considered) is written to
 * `admin_audit_log` under `auth.google.linked`.
 */
export const linkGoogleAccountByEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { ip, userAgent } = requestMeta();
    const userId = context.userId;
    const claims: any = context.claims ?? {};
    const email = (claims.email ?? "").toString().toLowerCase();
    if (!email) {
      return { ok: true as const, decision: "none" as const, reason: "no_email" };
    }

    type Candidate = {
      id: string;
      created_at: string | null;
      hasGoogle: boolean;
      emailConfirmed: boolean;
    };

    let candidates: Candidate[] = [];
    let listError: string | null = null;
    try {
      const { data, error } = await (supabaseAdmin as any).auth.admin.listUsers({
        page: 1,
        perPage: 200,
      });
      if (error) throw error;
      candidates = (data?.users ?? [])
        .filter((u: any) => (u.email ?? "").toLowerCase() === email && u.id !== userId)
        .map((u: any) => ({
          id: u.id,
          created_at: u.created_at ?? null,
          hasGoogle: (u.identities ?? []).some((i: any) => i.provider === "google"),
          emailConfirmed: Boolean(u.email_confirmed_at ?? u.confirmed_at),
        }));
    } catch (e) {
      listError = (e as Error).message;
    }

    let decision:
      | "none"
      | "linked_single"
      | "linked_oldest"
      | "skipped_google"
      | "skipped_error" = "none";
    let chosenLegacyId: string | null = null;
    let resolution = "no_duplicates";

    if (listError) {
      decision = "skipped_error";
      resolution = "list_users_failed";
    } else if (candidates.length === 0) {
      decision = "none";
      resolution = "no_duplicates";
    } else {
      const linkable = candidates
        .filter((c) => !c.hasGoogle)
        .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
      if (linkable.length === 0) {
        decision = "skipped_google";
        resolution = "all_duplicates_have_google_identity";
      } else {
        chosenLegacyId = linkable[0].id;
        decision = candidates.length === 1 ? "linked_single" : "linked_oldest";
        resolution =
          candidates.length === 1
            ? "single_legacy_account_linked"
            : `oldest_of_${candidates.length}_linked`;

        // Copy non-destructive profile data forward (only when current is empty).
        try {
          const { data: currentProfile } = await (supabaseAdmin as any)
            .from("profiles")
            .select("display_name, avatar_url, premium_plan, premium_until, is_premium")
            .eq("id", userId)
            .maybeSingle();
          const { data: legacyProfile } = await (supabaseAdmin as any)
            .from("profiles")
            .select("display_name, avatar_url, premium_plan, premium_until, is_premium")
            .eq("id", chosenLegacyId)
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

        // For ambiguous multi-account collisions, surface an admin alert.
        if (candidates.length > 1) {
          try {
            await (supabaseAdmin as any).from("admin_alerts").insert({
              kind: "auth_link_conflict",
              severity: "warn",
              subject: `Multiple accounts share email ${email}`,
              source: "linkGoogleAccountByEmail",
              details: {
                email,
                current_user_id: userId,
                chosen_legacy_id: chosenLegacyId,
                candidates,
              },
            });
          } catch {
            /* alert table is best-effort */
          }
        }
      }
    }

    try {
      await (supabaseAdmin as any).from("admin_audit_log").insert({
        action: "auth.google.linked",
        status: decision === "skipped_error" ? "failed" : "info",
        actor_user_id: userId,
        actor_email: email,
        ip,
        user_agent: userAgent,
        metadata: {
          decision,
          resolution,
          chosen_legacy_id: chosenLegacyId,
          candidate_count: candidates.length,
          candidates,
          list_error: listError,
        },
      });
    } catch (e) {
      console.warn("[auth-link] audit insert failed", (e as Error).message);
    }

    return {
      ok: true as const,
      decision,
      resolution,
      chosen_legacy_id: chosenLegacyId,
      candidate_count: candidates.length,
    };
  });

// ---------------------------------------------------------------------------
// Auth events analytics — powers the admin dashboard widget.
// ---------------------------------------------------------------------------

const AuthAnalyticsRange = z.enum(["24h", "7d", "30d"]);
const AuthAnalyticsProvider = z.enum(["all", "email", "google"]);

const AuthAnalyticsInputSchema = z.object({
  range: AuthAnalyticsRange.default("7d"),
  provider: AuthAnalyticsProvider.default("all"),
});

export type AuthEventsAnalytics = {
  generatedAt: string;
  range: z.infer<typeof AuthAnalyticsRange>;
  provider: z.infer<typeof AuthAnalyticsProvider>;
  totals: {
    signinSuccess: number;
    signinFailed: number;
    signupSuccess: number;
    signupFailed: number;
    googleSuccess: number;
    googleFailed: number;
    signout: number;
  };
  failuresByReason: Array<{ reason: string; count: number }>;
  timeseries: Array<{
    bucket: string;
    signin_success: number;
    signin_failed: number;
    signup_success: number;
    signup_failed: number;
    google_success: number;
    google_failed: number;
    signout: number;
  }>;
  recentFailures: Array<{
    id: string;
    created_at: string;
    action: string;
    actor_email: string | null;
    failure_reason: string | null;
    message: string | null;
    provider: string | null;
  }>;
};

function rangeStart(range: "24h" | "7d" | "30d"): Date {
  const now = Date.now();
  const ms = range === "24h" ? 24 * 3600_000 : range === "7d" ? 7 * 24 * 3600_000 : 30 * 24 * 3600_000;
  return new Date(now - ms);
}

function bucketKey(date: Date, range: "24h" | "7d" | "30d"): string {
  if (range === "24h") {
    const d = new Date(date);
    d.setMinutes(0, 0, 0);
    return d.toISOString();
  }
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

export const getAuthEventsAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => AuthAnalyticsInputSchema.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<AuthEventsAnalytics> => {
    await requireAdminAccess(context);
    const sb = context.supabase;
    const start = rangeStart(data.range);

    const actions = AUTH_EVENT_ACTIONS.filter((a) => a !== "auth.google.linked");
    const { data: rows, error } = await sb
      .from("admin_audit_log")
      .select("id, action, status, actor_email, metadata, created_at")
      .gte("created_at", start.toISOString())
      .in("action", actions as unknown as string[])
      .order("created_at", { ascending: false })
      .limit(5000);
    if (error) throw new Error(error.message);

    const filtered = (rows ?? []).filter((row) => {
      if (data.provider === "all") return true;
      const provider = ((row.metadata as any) ?? {})?.provider as string | undefined;
      // auth.google.* implicitly provider=google even if metadata missing.
      if (data.provider === "google") return row.action.includes("google") || provider === "google";
      return !row.action.includes("google") && provider !== "google";
    });

    const totals = {
      signinSuccess: 0,
      signinFailed: 0,
      signupSuccess: 0,
      signupFailed: 0,
      googleSuccess: 0,
      googleFailed: 0,
      signout: 0,
    };
    const failuresByReason = new Map<string, number>();
    const buckets = new Map<string, AuthEventsAnalytics["timeseries"][number]>();

    for (const row of filtered) {
      const key = bucketKey(new Date(row.created_at), data.range);
      const bucket = buckets.get(key) ?? {
        bucket: key,
        signin_success: 0,
        signin_failed: 0,
        signup_success: 0,
        signup_failed: 0,
        google_success: 0,
        google_failed: 0,
        signout: 0,
      };

      switch (row.action) {
        case "auth.signin.success":
          totals.signinSuccess++;
          bucket.signin_success++;
          break;
        case "auth.signin.failed":
          totals.signinFailed++;
          bucket.signin_failed++;
          break;
        case "auth.signup.success":
          totals.signupSuccess++;
          bucket.signup_success++;
          break;
        case "auth.signup.failed":
          totals.signupFailed++;
          bucket.signup_failed++;
          break;
        case "auth.google.success":
          totals.googleSuccess++;
          bucket.google_success++;
          break;
        case "auth.google.failed":
          totals.googleFailed++;
          bucket.google_failed++;
          break;
        case "auth.signout":
          totals.signout++;
          bucket.signout++;
          break;
      }
      buckets.set(key, bucket);

      if (row.action.endsWith(".failed")) {
        const reason = (((row.metadata as any) ?? {})?.failure_reason as string | null) ?? "unknown";
        failuresByReason.set(reason, (failuresByReason.get(reason) ?? 0) + 1);
      }
    }

    const timeseries = Array.from(buckets.values()).sort((a, b) => a.bucket.localeCompare(b.bucket));
    const failureRows = Array.from(failuresByReason.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);

    const recentFailures = filtered
      .filter((row) => row.action.endsWith(".failed"))
      .slice(0, 25)
      .map((row) => {
        const meta = (row.metadata as any) ?? {};
        return {
          id: row.id,
          created_at: row.created_at,
          action: row.action,
          actor_email: row.actor_email,
          failure_reason: meta.failure_reason ?? null,
          message: meta.message ?? null,
          provider: meta.provider ?? null,
        };
      });

    return {
      generatedAt: new Date().toISOString(),
      range: data.range,
      provider: data.provider,
      totals,
      failuresByReason: failureRows,
      timeseries,
      recentFailures,
    };
  });
