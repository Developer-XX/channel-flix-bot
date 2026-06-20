import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GOOGLE_DISCOVERY = "https://accounts.google.com/.well-known/openid-configuration";
const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error) throw new Error(`Role check failed: ${error.message}`);
  if (!data) throw new Error("Forbidden: admin role required");
}

function maskSecret(v: string | null | undefined): string | null {
  if (!v) return null;
  if (v.length <= 6) return "•".repeat(v.length);
  return v.slice(0, 4) + "•".repeat(Math.max(4, v.length - 8)) + v.slice(-4);
}

// ---------- Read config (masked) ----------
export const getGoogleOAuthConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { data, error } = await supabase
      .from("google_oauth_credentials")
      .select("id, client_id, client_secret, redirect_uri, updated_at, updated_by")
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      return { configured: false, clientId: null, clientSecretMasked: null, redirectUri: null, updatedAt: null };
    }
    return {
      configured: !!(data.client_id && data.client_secret),
      clientId: data.client_id ?? null,
      clientSecretMasked: maskSecret(data.client_secret),
      redirectUri: data.redirect_uri ?? null,
      updatedAt: data.updated_at,
    };
  });

// ---------- Save config ----------
const SaveSchema = z.object({
  clientId: z.string().trim().min(10).max(256),
  clientSecret: z.string().trim().min(8).max(256),
  redirectUri: z.string().trim().url().max(512),
});

export const saveGoogleOAuthConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SaveSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { data: existing } = await supabase
      .from("google_oauth_credentials")
      .select("id")
      .limit(1)
      .maybeSingle();
    const payload = {
      client_id: data.clientId,
      client_secret: data.clientSecret,
      redirect_uri: data.redirectUri,
      updated_by: userId,
    };
    if (existing?.id) {
      const { error } = await supabase
        .from("google_oauth_credentials")
        .update(payload)
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.from("google_oauth_credentials").insert(payload);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

// ---------- Helpers ----------
async function loadCreds(supabase: any) {
  const { data, error } = await supabase
    .from("google_oauth_credentials")
    .select("client_id, client_secret, redirect_uri")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.client_id || !data?.client_secret || !data?.redirect_uri) {
    throw new Error("Google OAuth credentials are not fully configured");
  }
  return data as { client_id: string; client_secret: string; redirect_uri: string };
}

async function logHealth(
  supabase: any,
  userId: string,
  row: {
    kind: "quick" | "full" | "full_pending";
    status: "ok" | "error" | "pending";
    error_code?: string | null;
    error_message?: string | null;
    latency_ms?: number | null;
    state_token?: string | null;
    details?: Record<string, unknown>;
  },
) {
  await supabase.from("google_oauth_health_log").insert({
    kind: row.kind,
    status: row.status,
    error_code: row.error_code ?? null,
    error_message: row.error_message ?? null,
    latency_ms: row.latency_ms ?? null,
    state_token: row.state_token ?? null,
    details: row.details ?? {},
    checked_by: userId,
  });
}

// ---------- Quick check ----------
export const quickCheckGoogleOAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);

    const started = Date.now();
    try {
      const creds = await loadCreds(supabase);

      // 1. Format check
      if (!/\.apps\.googleusercontent\.com$/i.test(creds.client_id)) {
        const msg = "Client ID does not look like a Google OAuth web client (must end with .apps.googleusercontent.com)";
        await logHealth(supabase, userId, {
          kind: "quick",
          status: "error",
          error_code: "invalid_client_id_format",
          error_message: msg,
          latency_ms: Date.now() - started,
        });
        return { ok: false, errorCode: "invalid_client_id_format", message: msg, latencyMs: Date.now() - started };
      }

      // 2. Discovery reachable
      const disc = await fetch(GOOGLE_DISCOVERY, { method: "GET" });
      if (!disc.ok) {
        const msg = `Google discovery endpoint returned HTTP ${disc.status}`;
        await logHealth(supabase, userId, {
          kind: "quick",
          status: "error",
          error_code: "discovery_failed",
          error_message: msg,
          latency_ms: Date.now() - started,
        });
        return { ok: false, errorCode: "discovery_failed", message: msg, latencyMs: Date.now() - started };
      }

      // 3. Ping authorization endpoint with prompt=none to see if client_id is recognized.
      // Valid client_id → 302 (or 200 with login). Invalid → 200 with error page containing "invalid_client".
      const params = new URLSearchParams({
        client_id: creds.client_id,
        redirect_uri: creds.redirect_uri,
        response_type: "code",
        scope: "openid email",
        state: "healthcheck",
        prompt: "none",
      });
      const probe = await fetch(`${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`, {
        method: "GET",
        redirect: "manual",
      });
      const body = probe.status === 200 ? (await probe.text()).slice(0, 4000) : "";
      const looksInvalid =
        /invalid[_ ]client/i.test(body) ||
        /Error 400/i.test(body) ||
        /The OAuth client was not found/i.test(body) ||
        /unauthorized_client/i.test(body);
      const looksRedirectMismatch =
        /redirect[_ ]uri[_ ]mismatch/i.test(body) || /Error 400: redirect_uri_mismatch/i.test(body);

      if (looksRedirectMismatch) {
        const msg = "Google rejected the redirect URI — add it to your OAuth client's Authorized redirect URIs.";
        await logHealth(supabase, userId, {
          kind: "quick",
          status: "error",
          error_code: "redirect_uri_mismatch",
          error_message: msg,
          latency_ms: Date.now() - started,
          details: { redirect_uri: creds.redirect_uri },
        });
        return {
          ok: false,
          errorCode: "redirect_uri_mismatch",
          message: msg,
          latencyMs: Date.now() - started,
        };
      }
      if (looksInvalid) {
        const msg = "Google does not recognize this Client ID. Re-check the value copied from Google Cloud Console.";
        await logHealth(supabase, userId, {
          kind: "quick",
          status: "error",
          error_code: "invalid_client",
          error_message: msg,
          latency_ms: Date.now() - started,
        });
        return { ok: false, errorCode: "invalid_client", message: msg, latencyMs: Date.now() - started };
      }

      const latency = Date.now() - started;
      await logHealth(supabase, userId, {
        kind: "quick",
        status: "ok",
        latency_ms: latency,
        details: { http: probe.status },
      });
      return { ok: true, message: "Client ID and redirect URI accepted by Google.", latencyMs: latency };
    } catch (e: any) {
      const msg = e?.message ?? "Unknown error";
      await logHealth(supabase, userId, {
        kind: "quick",
        status: "error",
        error_code: "exception",
        error_message: msg,
        latency_ms: Date.now() - started,
      });
      return { ok: false, errorCode: "exception", message: msg, latencyMs: Date.now() - started };
    }
  });

// ---------- Full flow: start ----------
export const startFullOAuthTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const creds = await loadCreds(supabase);
    const state = crypto.randomUUID();
    await logHealth(supabase, userId, {
      kind: "full_pending",
      status: "pending",
      state_token: state,
      details: { redirect_uri: creds.redirect_uri },
    });
    const params = new URLSearchParams({
      client_id: creds.client_id,
      redirect_uri: creds.redirect_uri,
      response_type: "code",
      scope: "openid email profile",
      access_type: "offline",
      prompt: "consent",
      state,
    });
    return { authUrl: `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`, state };
  });

// ---------- Full flow: complete ----------
const CompleteSchema = z.object({
  state: z.string().min(8).max(128),
  code: z.string().min(4).max(2048),
});

export const completeFullOAuthTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CompleteSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const started = Date.now();

    // Verify the state corresponds to a pending row this admin initiated within 10 minutes.
    const { data: pending, error: pendErr } = await supabase
      .from("google_oauth_health_log")
      .select("id, checked_by, checked_at, kind")
      .eq("state_token", data.state)
      .eq("kind", "full_pending")
      .order("checked_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (pendErr) throw new Error(pendErr.message);
    if (!pending) {
      const msg = "State token not found or already used.";
      await logHealth(supabase, userId, {
        kind: "full",
        status: "error",
        error_code: "invalid_state",
        error_message: msg,
        latency_ms: Date.now() - started,
      });
      return { ok: false, errorCode: "invalid_state", message: msg };
    }
    if (Date.now() - new Date(pending.checked_at).getTime() > 10 * 60_000) {
      const msg = "OAuth test request expired. Please start it again.";
      await logHealth(supabase, userId, {
        kind: "full",
        status: "error",
        error_code: "state_expired",
        error_message: msg,
        latency_ms: Date.now() - started,
      });
      return { ok: false, errorCode: "state_expired", message: msg };
    }

    let creds;
    try {
      creds = await loadCreds(supabase);
    } catch (e: any) {
      const msg = e?.message ?? "Missing credentials";
      await logHealth(supabase, userId, {
        kind: "full",
        status: "error",
        error_code: "missing_credentials",
        error_message: msg,
        latency_ms: Date.now() - started,
      });
      return { ok: false, errorCode: "missing_credentials", message: msg };
    }

    const body = new URLSearchParams({
      code: data.code,
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      redirect_uri: creds.redirect_uri,
      grant_type: "authorization_code",
    });
    let res: Response;
    try {
      res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
    } catch (e: any) {
      const msg = `Network error contacting Google: ${e?.message ?? e}`;
      await logHealth(supabase, userId, {
        kind: "full",
        status: "error",
        error_code: "network_error",
        error_message: msg,
        latency_ms: Date.now() - started,
      });
      return { ok: false, errorCode: "network_error", message: msg };
    }

    const json: any = await res.json().catch(() => ({}));
    const latency = Date.now() - started;

    if (!res.ok || json.error) {
      const code = String(json.error ?? `http_${res.status}`);
      const desc = json.error_description ?? `Google returned HTTP ${res.status}`;
      let friendly = desc;
      if (code === "invalid_client") friendly = "Client ID or Client Secret is incorrect.";
      else if (code === "redirect_uri_mismatch") friendly = "Redirect URI does not match any URI registered in Google Cloud Console.";
      else if (code === "invalid_grant") friendly = "Authorization code is invalid, expired, or already used.";
      await logHealth(supabase, userId, {
        kind: "full",
        status: "error",
        error_code: code,
        error_message: friendly,
        latency_ms: latency,
        details: { http: res.status, raw: json },
      });
      return { ok: false, errorCode: code, message: friendly, latencyMs: latency };
    }

    await logHealth(supabase, userId, {
      kind: "full",
      status: "ok",
      latency_ms: latency,
      details: {
        has_id_token: !!json.id_token,
        has_refresh_token: !!json.refresh_token,
        scope: json.scope,
        token_type: json.token_type,
        expires_in: json.expires_in,
      },
    });

    // Clean up the pending marker.
    await supabase.from("google_oauth_health_log").delete().eq("id", pending.id);

    return {
      ok: true,
      message: "Token exchange succeeded — Google OAuth is fully working.",
      latencyMs: latency,
      hasRefreshToken: !!json.refresh_token,
    };
  });

// ---------- Recent health log ----------
export const listGoogleOAuthHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { data, error } = await supabase
      .from("google_oauth_health_log")
      .select("id, checked_at, kind, status, error_code, error_message, latency_ms")
      .in("kind", ["quick", "full"])
      .order("checked_at", { ascending: false })
      .limit(25);
    if (error) throw new Error(error.message);
    return { rows: data ?? [] };
  });

// ---------- Latest status (for analytics surface) ----------
export const getGoogleOAuthLatestHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context as any;
    const { data, error } = await supabase.rpc("get_google_oauth_latest_health");
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    return row
      ? {
          checkedAt: row.checked_at,
          kind: row.kind as "quick" | "full",
          status: row.status as "ok" | "error",
          errorCode: row.error_code ?? null,
          errorMessage: row.error_message ?? null,
          latencyMs: row.latency_ms ?? null,
        }
      : null;
  });
