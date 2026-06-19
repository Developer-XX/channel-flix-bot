import { createServerFn } from "@tanstack/react-start";
import { createClient, type Session } from "@supabase/supabase-js";
import { getRequestHeader, getRequestIP } from "@tanstack/react-start/server";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

const AuthActionSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(6).max(128).optional(),
  origin: z.string().url(),
  website: z.string().max(200).optional().default(""),
  startedAt: z.number().int().positive(),
});

function createAuthClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Auth backend is not configured");

  return createClient<Database>(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

function botProtection(input: { website?: string; startedAt: number }) {
  const elapsedMs = Date.now() - input.startedAt;
  if (input.website?.trim()) {
    return { status: 400, code: "bot_detected", message: "Bot protection check failed. Please reload and try again." };
  }
  if ((elapsedMs >= 0 && elapsedMs < 1200) || elapsedMs > 30 * 60 * 1000) {
    return { status: 400, code: "bot_challenge_failed", message: "Security check expired. Please reload and try again." };
  }
  return null;
}

type AuthAction = "signin" | "signup" | "reset";

const RATE_LIMITS: Record<AuthAction, { max: number; windowMs: number; blockMs: number; label: string }> = {
  signin: { max: 5, windowMs: 10 * 60 * 1000, blockMs: 15 * 60 * 1000, label: "sign-in" },
  signup: { max: 3, windowMs: 60 * 60 * 1000, blockMs: 30 * 60 * 1000, label: "signup" },
  reset: { max: 3, windowMs: 60 * 60 * 1000, blockMs: 30 * 60 * 1000, label: "password reset" },
};

function hashRateKey(value: string) {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return `rl_${(hash >>> 0).toString(36)}`;
}

function getRateKey(action: AuthAction, email: string) {
  const ip = getRequestIP({ xForwardedFor: true }) ?? getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown-ip";
  const userAgent = getRequestHeader("user-agent")?.slice(0, 160) ?? "unknown-agent";
  return hashRateKey(`${action}:${email.trim().toLowerCase()}:${ip}:${userAgent}`);
}

function throttleError(action: AuthAction, blockedUntil: Date) {
  const retryAfterSeconds = Math.max(1, Math.ceil((blockedUntil.getTime() - Date.now()) / 1000));
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return {
    status: 429,
    code: "auth_rate_limited",
    message: `Too many ${RATE_LIMITS[action].label} attempts. Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    retryAfterSeconds,
  };
}

async function enforceRateLimit(action: AuthAction, email: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const rateKey = getRateKey(action, email);
  const config = RATE_LIMITS[action];
  const now = new Date();
  const windowCutoff = new Date(now.getTime() - config.windowMs);
  const table = (supabaseAdmin as any).from("auth_rate_limits");
  const { data: row, error } = await table
    .select("rate_key, action, window_start, attempts, blocked_until")
    .eq("rate_key", rateKey)
    .eq("action", action)
    .maybeSingle();

  if (error) {
    console.error("[auth-rate-limit] read failed", error);
    return null;
  }

  if (row?.blocked_until) {
    const blockedUntil = new Date(row.blocked_until);
    if (blockedUntil.getTime() > now.getTime()) return throttleError(action, blockedUntil);
  }

  const windowStart = row?.window_start ? new Date(row.window_start) : null;
  const resetWindow = !windowStart || windowStart.getTime() < windowCutoff.getTime();
  const attempts = resetWindow ? 1 : Number(row?.attempts ?? 0) + 1;
  const blockedUntil = attempts > config.max ? new Date(now.getTime() + config.blockMs) : null;
  const { error: writeError } = await table.upsert({
    rate_key: rateKey,
    action,
    window_start: resetWindow ? now.toISOString() : row.window_start,
    attempts,
    blocked_until: blockedUntil?.toISOString() ?? null,
    last_attempt_at: now.toISOString(),
  }, { onConflict: "rate_key,action" });

  if (writeError) console.error("[auth-rate-limit] write failed", writeError);
  return blockedUntil ? throttleError(action, blockedUntil) : null;
}

async function clearRateLimit(action: AuthAction, email: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await (supabaseAdmin as any)
    .from("auth_rate_limits")
    .delete()
    .eq("rate_key", getRateKey(action, email))
    .eq("action", action);
  if (error) console.error("[auth-rate-limit] clear failed", error);
}

function redirectOrigin(inputOrigin: string) {
  const requestOrigin = getRequestHeader("origin");
  try {
    return new URL(requestOrigin || inputOrigin).origin;
  } catch {
    return new URL(inputOrigin).origin;
  }
}

function serializeSession(session: Session | null) {
  if (!session) return null;
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at ?? null,
  };
}

function serializeError(error: unknown, fallback: string) {
  const e = error as { status?: number; code?: string; error_code?: string; message?: string };
  return {
    status: e?.status ?? 500,
    code: e?.code ?? e?.error_code ?? "auth_error",
    message: e?.message ?? fallback,
  };
}

async function recordAuthAudit(action: string, email: string, status: "success" | "failed", extra: Record<string, unknown> = {}) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ip =
      getRequestIP({ xForwardedFor: true }) ??
      getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim() ??
      null;
    const userAgent = getRequestHeader("user-agent")?.slice(0, 256) ?? null;
    await (supabaseAdmin as any).from("admin_audit_log").insert({
      action,
      status,
      actor_email: email,
      ip,
      user_agent: userAgent,
      metadata: { provider: "email", ...extra },
    });
  } catch (e) {
    console.warn("[auth-audit] insert failed", (e as Error).message);
  }
}

export const signInWithBotCheck = createServerFn({ method: "POST" })
  .inputValidator((input) => AuthActionSchema.extend({ password: z.string().min(6).max(128) }).parse(input))
  .handler(async ({ data }) => {
    const throttle = await enforceRateLimit("signin", data.email);
    if (throttle) {
      await recordAuthAudit("auth.signin.failed", data.email, "failed", { code: throttle.code });
      return { ok: false as const, error: throttle };
    }
    const botError = botProtection(data);
    if (botError) {
      await recordAuthAudit("auth.signin.failed", data.email, "failed", { code: botError.code });
      return { ok: false as const, error: botError };
    }

    const { data: result, error } = await createAuthClient().auth.signInWithPassword({
      email: data.email,
      password: data.password,
    });

    if (error) {
      await recordAuthAudit("auth.signin.failed", data.email, "failed", { code: (error as any).code, message: error.message });
      return { ok: false as const, error: serializeError(error, "Sign in failed") };
    }
    await clearRateLimit("signin", data.email);
    await recordAuthAudit("auth.signin.success", data.email, "success");
    return { ok: true as const, session: serializeSession(result.session) };
  });

export const signUpWithBotCheck = createServerFn({ method: "POST" })
  .inputValidator((input) => AuthActionSchema.extend({ password: z.string().min(6).max(128) }).parse(input))
  .handler(async ({ data }) => {
    const throttle = await enforceRateLimit("signup", data.email);
    if (throttle) {
      await recordAuthAudit("auth.signup.failed", data.email, "failed", { code: throttle.code });
      return { ok: false as const, error: throttle };
    }
    const botError = botProtection(data);
    if (botError) {
      await recordAuthAudit("auth.signup.failed", data.email, "failed", { code: botError.code });
      return { ok: false as const, error: botError };
    }

    const { data: result, error } = await createAuthClient().auth.signUp({
      email: data.email,
      password: data.password,
      options: { emailRedirectTo: `${redirectOrigin(data.origin)}/` },
    });

    if (error) {
      await recordAuthAudit("auth.signup.failed", data.email, "failed", { code: (error as any).code, message: error.message });
      return { ok: false as const, error: serializeError(error, "Account creation failed") };
    }
    await clearRateLimit("signup", data.email);
    await recordAuthAudit("auth.signup.success", data.email, "success");
    return { ok: true as const, session: serializeSession(result.session) };
  });


export const requestPasswordReset = createServerFn({ method: "POST" })
  .inputValidator((input) => AuthActionSchema.omit({ password: true }).parse(input))
  .handler(async ({ data }) => {
    const throttle = await enforceRateLimit("reset", data.email);
    if (throttle) return { ok: false as const, error: throttle };
    const botError = botProtection(data);
    if (botError) return { ok: false as const, error: botError };

    const { error } = await createAuthClient().auth.resetPasswordForEmail(data.email, {
      redirectTo: `${redirectOrigin(data.origin)}/reset-password`,
    });

    if (error) return { ok: false as const, error: serializeError(error, "Password reset failed") };
    return { ok: true as const };
  });