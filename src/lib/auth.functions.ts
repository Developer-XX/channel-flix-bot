import { createServerFn } from "@tanstack/react-start";
import { createClient, type Session } from "@supabase/supabase-js";
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
  if (elapsedMs < 1200 || elapsedMs > 30 * 60 * 1000) {
    return { status: 400, code: "bot_challenge_failed", message: "Security check expired. Please reload and try again." };
  }
  return null;
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

export const signInWithBotCheck = createServerFn({ method: "POST" })
  .inputValidator((input) => AuthActionSchema.extend({ password: z.string().min(6).max(128) }).parse(input))
  .handler(async ({ data }) => {
    const botError = botProtection(data);
    if (botError) return { ok: false as const, error: botError };

    const { data: result, error } = await createAuthClient().auth.signInWithPassword({
      email: data.email,
      password: data.password,
    });

    if (error) return { ok: false as const, error: serializeError(error, "Sign in failed") };
    return { ok: true as const, session: serializeSession(result.session) };
  });

export const signUpWithBotCheck = createServerFn({ method: "POST" })
  .inputValidator((input) => AuthActionSchema.extend({ password: z.string().min(6).max(128) }).parse(input))
  .handler(async ({ data }) => {
    const botError = botProtection(data);
    if (botError) return { ok: false as const, error: botError };

    const { data: result, error } = await createAuthClient().auth.signUp({
      email: data.email,
      password: data.password,
      options: { emailRedirectTo: `${data.origin}/` },
    });

    if (error) return { ok: false as const, error: serializeError(error, "Account creation failed") };
    return { ok: true as const, session: serializeSession(result.session) };
  });

export const requestPasswordReset = createServerFn({ method: "POST" })
  .inputValidator((input) => AuthActionSchema.omit({ password: true }).parse(input))
  .handler(async ({ data }) => {
    const botError = botProtection(data);
    if (botError) return { ok: false as const, error: botError };

    const { error } = await createAuthClient().auth.resetPasswordForEmail(data.email, {
      redirectTo: `${data.origin}/reset-password`,
    });

    if (error) return { ok: false as const, error: serializeError(error, "Password reset failed") };
    return { ok: true as const };
  });