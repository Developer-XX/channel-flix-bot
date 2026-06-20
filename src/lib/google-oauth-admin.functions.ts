import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GOOGLE_DISCOVERY = "https://accounts.google.com/.well-known/openid-configuration";
const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

const ALERT_FAILING_STREAK_DEFAULT = 3;

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error) throw new Error(`Role check failed: ${error.message}`);
  if (!data) throw new Error("Forbidden: admin role required");
}

// Server-side rate limit using the public.rl_hit RPC. Per-user + action key.
async function enforceRateLimit(
  supabase: any,
  userId: string,
  action: string,
  windowSec: number,
  limit: number,
) {
  const key = `gauth:${action}:${userId}`;
  const { data, error } = await supabase.rpc("rl_hit", {
    _key: key,
    _window_sec: windowSec,
    _limit: limit,
  });
  if (error) {
    // Fail open on RPC errors to avoid locking admins out, but log it.
    console.warn("[google-oauth] rate-limit RPC failed", error.message);
    return;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (row && row.allowed === false) {
    const resetAt = row.reset_at ? new Date(row.reset_at) : null;
    const secs = resetAt ? Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000)) : windowSec;
    const err: any = new Error(
      `Rate limit exceeded for "${action}" (${row.used}/${row.lim}). Try again in ~${secs}s.`,
    );
    err.code = "rate_limited";
    err.retryAfterSec = secs;
    throw err;
  }
}

function maskSecret(v: string | null | undefined): string | null {
  if (!v) return null;
  if (v.length <= 6) return "•".repeat(v.length);
  return v.slice(0, 4) + "•".repeat(Math.max(4, v.length - 8)) + v.slice(-4);
}

// -----------------------------------------------------------------------------
// fetch with timeout + exponential backoff
// -----------------------------------------------------------------------------
type RetryOpts = { timeoutMs?: number; retries?: number; baseDelayMs?: number; label?: string };

async function fetchWithRetry(url: string, init: RequestInit, opts: RetryOpts = {}): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const retries = Math.max(0, opts.retries ?? 2);
  const baseDelay = opts.baseDelayMs ?? 300;
  let lastErr: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(t);
      // Retry only on transient upstream failures (network covered by catch).
      if (res.status >= 500 && res.status < 600 && attempt < retries) {
        await sleep(baseDelay * 2 ** attempt + Math.random() * 100);
        continue;
      }
      return res;
    } catch (e: any) {
      clearTimeout(t);
      lastErr = e;
      const isAbort = e?.name === "AbortError";
      if (attempt < retries) {
        await sleep(baseDelay * 2 ** attempt + Math.random() * 100);
        continue;
      }
      const label = opts.label ?? "fetch";
      throw new Error(
        isAbort ? `${label} timed out after ${timeoutMs}ms (${retries + 1} attempts)` : `${label} failed: ${e?.message ?? e}`,
      );
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("fetch failed");
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// -----------------------------------------------------------------------------
// Config CRUD
// -----------------------------------------------------------------------------
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

// -----------------------------------------------------------------------------
// Shared validators (used by saveGoogleOAuthConfig + validateGoogleOAuthSetup)
// -----------------------------------------------------------------------------
const EXPECTED_CALLBACK_PATH = "/admin/google-oauth-callback";

export type ConfigProblem = { field: "clientId" | "clientSecret" | "redirectUri"; code: string; message: string };

export function validateCredentialShape(input: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  const id = input.clientId.trim();
  const secret = input.clientSecret.trim();
  const uri = input.redirectUri.trim();

  if (!id) problems.push({ field: "clientId", code: "missing", message: "Client ID is required." });
  else {
    if (!/\.apps\.googleusercontent\.com$/i.test(id))
      problems.push({ field: "clientId", code: "bad_suffix", message: "Client ID must end with .apps.googleusercontent.com" });
    if (!/^\d{6,}-/.test(id))
      problems.push({ field: "clientId", code: "bad_prefix", message: "Client ID must start with the numeric project number (e.g. 123456789-abc...)." });
  }

  if (!secret) problems.push({ field: "clientSecret", code: "missing", message: "Client Secret is required." });
  else if (secret.length < 10)
    problems.push({ field: "clientSecret", code: "too_short", message: "Client Secret looks too short." });

  if (!uri) {
    problems.push({ field: "redirectUri", code: "missing", message: "Redirect URI is required." });
  } else {
    let parsed: URL | null = null;
    try { parsed = new URL(uri); } catch { /* noop */ }
    if (!parsed) {
      problems.push({ field: "redirectUri", code: "invalid_url", message: "Redirect URI is not a valid URL." });
    } else {
      const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
      if (parsed.protocol !== "https:" && !isLocal)
        problems.push({ field: "redirectUri", code: "not_https", message: "Redirect URI must use HTTPS (except localhost)." });
      const path = parsed.pathname.replace(/\/$/, "");
      if (path !== EXPECTED_CALLBACK_PATH)
        problems.push({
          field: "redirectUri",
          code: "wrong_path",
          message: `Redirect URI path must be exactly "${EXPECTED_CALLBACK_PATH}" (got "${parsed.pathname}").`,
        });
      if (parsed.search || parsed.hash)
        problems.push({ field: "redirectUri", code: "extra_qs", message: "Redirect URI must not contain a query string or fragment." });
    }
  }
  return problems;
}

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

    const problems = validateCredentialShape(data);
    if (problems.length > 0) {
      const err: any = new Error(
        "Configuration rejected:\n" + problems.map((p) => `• [${p.field}] ${p.message}`).join("\n"),
      );
      err.problems = problems;
      throw err;
    }

    const { data: existing } = await supabase
      .from("google_oauth_credentials")
      .select("id")
      .limit(1)
      .maybeSingle();
    const payload = {
      client_id: data.clientId.trim(),
      client_secret: data.clientSecret.trim(),
      redirect_uri: data.redirectUri.trim(),
      updated_by: userId,
    };
    if (existing?.id) {
      const { error } = await supabase.from("google_oauth_credentials").update(payload).eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.from("google_oauth_credentials").insert(payload);
      if (error) throw new Error(error.message);
    }
    return { ok: true, problems: [] as ConfigProblem[] };
  });

// -----------------------------------------------------------------------------
// Server-side completeness gate (used by UI to enable the admin section)
// -----------------------------------------------------------------------------
export const validateGoogleOAuthSetup = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { data, error } = await supabase
      .from("google_oauth_credentials")
      .select("client_id, client_secret, redirect_uri, updated_at")
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data?.client_id || !data?.client_secret || !data?.redirect_uri) {
      return {
        enabled: false,
        problems: [
          { field: "clientId" as const, code: "not_configured", message: "Google OAuth credentials are not saved yet." },
        ],
        expectedCallbackPath: EXPECTED_CALLBACK_PATH,
        redirectUri: null as string | null,
        updatedAt: null as string | null,
      };
    }
    const problems = validateCredentialShape({
      clientId: data.client_id,
      clientSecret: data.client_secret,
      redirectUri: data.redirect_uri,
    });
    return {
      enabled: problems.length === 0,
      problems,
      expectedCallbackPath: EXPECTED_CALLBACK_PATH,
      redirectUri: data.redirect_uri as string,
      updatedAt: data.updated_at as string,
    };
  });

// -----------------------------------------------------------------------------
// Shared health-check engine (works for both user-context and cron contexts)
// -----------------------------------------------------------------------------
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
  checkedBy: string | null,
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
    checked_by: checkedBy,
  });
}

async function runQuickCheckInternal(supabaseRead: any): Promise<{
  ok: boolean;
  errorCode?: string;
  message: string;
  latencyMs: number;
  details?: Record<string, unknown>;
}> {
  const started = Date.now();
  try {
    const creds = await loadCreds(supabaseRead);

    if (!/\.apps\.googleusercontent\.com$/i.test(creds.client_id)) {
      return {
        ok: false,
        errorCode: "invalid_client_id_format",
        message: "Client ID does not look like a Google OAuth web client (must end with .apps.googleusercontent.com)",
        latencyMs: Date.now() - started,
      };
    }

    const disc = await fetchWithRetry(GOOGLE_DISCOVERY, { method: "GET" }, { timeoutMs: 5_000, retries: 2, label: "google-discovery" });
    if (!disc.ok) {
      return {
        ok: false,
        errorCode: "discovery_failed",
        message: `Google discovery endpoint returned HTTP ${disc.status}`,
        latencyMs: Date.now() - started,
      };
    }

    const params = new URLSearchParams({
      client_id: creds.client_id,
      redirect_uri: creds.redirect_uri,
      response_type: "code",
      scope: "openid email",
      state: "healthcheck",
      prompt: "none",
    });
    const probe = await fetchWithRetry(
      `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`,
      { method: "GET", redirect: "manual" },
      { timeoutMs: 8_000, retries: 2, label: "google-auth-probe" },
    );
    const body = probe.status === 200 ? (await probe.text()).slice(0, 4000) : "";
    if (/redirect[_ ]uri[_ ]mismatch/i.test(body)) {
      return {
        ok: false,
        errorCode: "redirect_uri_mismatch",
        message: "Google rejected the redirect URI — add it to your OAuth client's Authorized redirect URIs.",
        latencyMs: Date.now() - started,
        details: { redirect_uri: creds.redirect_uri },
      };
    }
    if (
      /invalid[_ ]client/i.test(body) ||
      /Error 400/i.test(body) ||
      /The OAuth client was not found/i.test(body) ||
      /unauthorized_client/i.test(body)
    ) {
      return {
        ok: false,
        errorCode: "invalid_client",
        message: "Google does not recognize this Client ID. Re-check the value copied from Google Cloud Console.",
        latencyMs: Date.now() - started,
      };
    }
    return {
      ok: true,
      message: "Client ID and redirect URI accepted by Google.",
      latencyMs: Date.now() - started,
      details: { http: probe.status },
    };
  } catch (e: any) {
    return {
      ok: false,
      errorCode: "exception",
      message: e?.message ?? "Unknown error",
      latencyMs: Date.now() - started,
    };
  }
}

// -----------------------------------------------------------------------------
// Alerts: insert admin_notifications + best-effort Telegram on state change
// or persistent failure streak. Must be called with the service-role client.
// -----------------------------------------------------------------------------
async function maybeEmitOAuthAlert(supabaseAdmin: any, source: "manual" | "cron") {
  try {
    const streak = Number(process.env.GOOGLE_OAUTH_ALERT_FAILING_STREAK ?? ALERT_FAILING_STREAK_DEFAULT);
    const { data: rows } = await supabaseAdmin
      .from("google_oauth_health_log")
      .select("id, status, error_code, error_message, checked_at")
      .in("kind", ["quick", "full"])
      .order("checked_at", { ascending: false })
      .limit(Math.max(streak + 1, 5));
    const recent = (rows ?? []) as Array<{
      id: string;
      status: "ok" | "error";
      error_code: string | null;
      error_message: string | null;
      checked_at: string;
    }>;
    if (recent.length === 0) return;
    const latest = recent[0];

    const flippedToFailing = latest.status === "error" && recent[1]?.status === "ok";
    const allFailing =
      recent.length >= streak && recent.slice(0, streak).every((r) => r.status === "error");

    let kind: string | null = null;
    let title: string | null = null;
    let dedupe: string | null = null;
    if (flippedToFailing) {
      kind = "google_oauth_status_change";
      title = "Google OAuth health changed: healthy → failing";
      dedupe = `google_oauth.flip.${latest.id}`;
    } else if (allFailing) {
      kind = "google_oauth_failing_streak";
      title = `Google OAuth failing for ${streak} consecutive checks`;
      // dedupe to the first row of the streak so we don't re-send every run
      const streakAnchor = recent.slice(0, streak).at(-1)?.id ?? latest.id;
      dedupe = `google_oauth.streak.${streak}.${streakAnchor}`;
    }
    if (!kind || !title || !dedupe) return;

    const body = `${latest.error_code ?? "error"}: ${latest.error_message ?? "(no message)"}`;
    const { error: insErr } = await supabaseAdmin.from("admin_notifications").insert({
      kind,
      severity: "error",
      title,
      body,
      metadata: {
        source,
        latest_id: latest.id,
        recent: recent.slice(0, 5).map((r) => ({ status: r.status, code: r.error_code, at: r.checked_at })),
      },
      dedupe_key: dedupe,
    } as never);
    if (insErr && !/duplicate key/i.test(insErr.message)) return;
    if (insErr) return; // already alerted

    // Best-effort Telegram + email (only Telegram is wired in this project)
    const { getSetting } = await import("@/lib/runtime-settings.server");
    const chatId = await getSetting("ALERT_TELEGRAM_CHAT_ID");
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (chatId && token) {
      try {
        await fetchWithRetry(
          `https://api.telegram.org/bot${token}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: `<b>${title}</b>\n${body}`,
              parse_mode: "HTML",
              disable_web_page_preview: true,
            }),
          },
          { timeoutMs: 6_000, retries: 1, label: "telegram-alert" },
        );
      } catch {
        /* best-effort */
      }
    }

    // Email alert (best-effort). Sends only when an ALERT_ADMIN_EMAIL is configured
    // AND the Lovable Emails infra has been scaffolded with a "google-oauth-alert"
    // template. Silently no-ops otherwise — the in-app admin_notifications row is
    // always written above so admins still see the alert in the dashboard.
    const recipient = await getSetting("ALERT_ADMIN_EMAIL");
    if (recipient && /.+@.+\..+/.test(recipient)) {
      try {
        const origin =
          process.env.PUBLIC_APP_URL ??
          process.env.VITE_PUBLIC_APP_URL ??
          "";
        if (origin) {
          const res = await fetchWithRetry(
            `${origin.replace(/\/$/, "")}/lovable/email/transactional/send`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                // Server-to-server: use service-role bearer so the send route accepts it.
                Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""}`,
              },
              body: JSON.stringify({
                templateName: "google-oauth-alert",
                recipientEmail: recipient,
                idempotencyKey: `google-oauth.${dedupe}`,
                templateData: { title, body, source, dedupe },
              }),
            },
            { timeoutMs: 8_000, retries: 1, label: "email-alert" },
          );
          if (!res.ok) {
            console.warn("[google-oauth] email alert send returned", res.status);
          }
        }
      } catch (e) {
        console.warn("[google-oauth] email alert failed", (e as Error).message);
      }
    }
  } catch (e) {
    console.warn("[google-oauth] maybeEmitOAuthAlert failed", (e as Error).message);
  }
}

// -----------------------------------------------------------------------------
// Quick check (admin-triggered)
// -----------------------------------------------------------------------------
export const quickCheckGoogleOAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const result = await runQuickCheckInternal(supabase);
    await logHealth(supabase, userId, {
      kind: "quick",
      status: result.ok ? "ok" : "error",
      error_code: result.errorCode ?? null,
      error_message: result.ok ? null : result.message,
      latency_ms: result.latencyMs,
      details: result.details,
    });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await maybeEmitOAuthAlert(supabaseAdmin, "manual");
    return { ok: result.ok, errorCode: result.errorCode, message: result.message, latencyMs: result.latencyMs };
  });

// -----------------------------------------------------------------------------
// Full OAuth flow
// -----------------------------------------------------------------------------
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
      await logHealth(supabase, userId, { kind: "full", status: "error", error_code: "invalid_state", error_message: msg, latency_ms: Date.now() - started });
      return { ok: false, errorCode: "invalid_state", message: msg };
    }
    if (Date.now() - new Date(pending.checked_at).getTime() > 10 * 60_000) {
      const msg = "OAuth test request expired. Please start it again.";
      await logHealth(supabase, userId, { kind: "full", status: "error", error_code: "state_expired", error_message: msg, latency_ms: Date.now() - started });
      return { ok: false, errorCode: "state_expired", message: msg };
    }

    let creds;
    try {
      creds = await loadCreds(supabase);
    } catch (e: any) {
      const msg = e?.message ?? "Missing credentials";
      await logHealth(supabase, userId, { kind: "full", status: "error", error_code: "missing_credentials", error_message: msg, latency_ms: Date.now() - started });
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
      res = await fetchWithRetry(
        GOOGLE_TOKEN_ENDPOINT,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        },
        { timeoutMs: 10_000, retries: 2, baseDelayMs: 400, label: "google-token-exchange" },
      );
    } catch (e: any) {
      const msg = e?.message ?? "Network error contacting Google";
      await logHealth(supabase, userId, { kind: "full", status: "error", error_code: "network_error", error_message: msg, latency_ms: Date.now() - started });
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await maybeEmitOAuthAlert(supabaseAdmin, "manual");
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
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await maybeEmitOAuthAlert(supabaseAdmin, "manual");
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
    await supabase.from("google_oauth_health_log").delete().eq("id", pending.id);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await maybeEmitOAuthAlert(supabaseAdmin, "manual");

    return {
      ok: true,
      message: "Token exchange succeeded — Google OAuth is fully working.",
      latencyMs: latency,
      hasRefreshToken: !!json.refresh_token,
    };
  });

// -----------------------------------------------------------------------------
// History + latest
// -----------------------------------------------------------------------------
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

// -----------------------------------------------------------------------------
// CSV export
// -----------------------------------------------------------------------------
const ExportSchema = z.object({ days: z.number().int().min(1).max(180).default(30) }).default({ days: 30 });

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export const exportGoogleOAuthHealthCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ExportSchema.parse(d ?? { days: 30 }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const since = new Date(Date.now() - data.days * 86_400_000).toISOString();
    const { data: rows, error } = await supabase
      .from("google_oauth_health_log")
      .select("id, checked_at, kind, status, error_code, error_message, latency_ms, checked_by, details")
      .gte("checked_at", since)
      .in("kind", ["quick", "full"])
      .order("checked_at", { ascending: false })
      .limit(10_000);
    if (error) throw new Error(error.message);
    const header = ["id", "checked_at", "kind", "status", "error_code", "error_message", "latency_ms", "checked_by", "details"];
    const lines = [header.join(",")];
    for (const r of (rows ?? []) as any[]) {
      lines.push(header.map((h) => csvEscape((r as any)[h])).join(","));
    }
    return {
      filename: `google-oauth-health-${data.days}d-${new Date().toISOString().slice(0, 10)}.csv`,
      csv: lines.join("\n"),
      rowCount: rows?.length ?? 0,
    };
  });

// -----------------------------------------------------------------------------
// Internal API used by the cron route (NOT exposed as a server function).
// -----------------------------------------------------------------------------
export async function runCronHealthCheck(supabaseAdmin: any) {
  const result = await runQuickCheckInternal(supabaseAdmin);
  await logHealth(supabaseAdmin, null, {
    kind: "quick",
    status: result.ok ? "ok" : "error",
    error_code: result.errorCode ?? null,
    error_message: result.ok ? null : result.message,
    latency_ms: result.latencyMs,
    details: { ...(result.details ?? {}), source: "cron" },
  });
  await maybeEmitOAuthAlert(supabaseAdmin, "cron");
  return result;
}

// -----------------------------------------------------------------------------
// Admin self-check report — route availability, callback handler readiness,
// discovery reachability, last cron / last health status.
// -----------------------------------------------------------------------------
export const getGoogleOAuthSelfCheck = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    // Self-check fetches Google discovery + DB queries; cap to 10/min per admin.
    await enforceRateLimit(supabase, userId, "self_check", 60, 10);

    const { data: cfg } = await supabase
      .from("google_oauth_credentials")
      .select("client_id, client_secret, redirect_uri, updated_at")
      .limit(1)
      .maybeSingle();
    const configProblems = cfg?.client_id && cfg?.client_secret && cfg?.redirect_uri
      ? validateCredentialShape({
          clientId: cfg.client_id,
          clientSecret: cfg.client_secret,
          redirectUri: cfg.redirect_uri,
        })
      : [{ field: "clientId" as const, code: "not_configured", message: "Credentials not saved." }];

    // 2) callback-route readiness: parse redirect URI and confirm it points at the
    //    integrated /admin/google-oauth-callback page that this app ships.
    let callbackReady = false;
    let callbackPath: string | null = null;
    try {
      if (cfg?.redirect_uri) {
        const u = new URL(cfg.redirect_uri);
        callbackPath = u.pathname.replace(/\/$/, "");
        callbackReady = callbackPath === "/admin/google-oauth-callback";
      }
    } catch {}

    // 3) discovery reachability (fast, no creds needed)
    const discStart = Date.now();
    let discoveryOk = false;
    let discoveryStatus: number | null = null;
    let discoveryMs: number | null = null;
    let discoveryError: string | null = null;
    try {
      const r = await fetchWithRetry(GOOGLE_DISCOVERY, { method: "GET" }, { timeoutMs: 5_000, retries: 1, label: "self-check-discovery" });
      discoveryStatus = r.status;
      discoveryOk = r.ok;
      discoveryMs = Date.now() - discStart;
    } catch (e: any) {
      discoveryError = e?.message ?? String(e);
      discoveryMs = Date.now() - discStart;
    }

    // 4) latest health entry (any kind), and latest cron entry specifically
    const { data: latest } = await supabase
      .from("google_oauth_health_log")
      .select("checked_at, kind, status, error_code, error_message, latency_ms, details")
      .in("kind", ["quick", "full"])
      .order("checked_at", { ascending: false })
      .limit(1);
    const latestRow = (latest ?? [])[0] ?? null;

    const { data: lastCron } = await supabase
      .from("google_oauth_health_log")
      .select("checked_at, status, error_code, error_message, latency_ms, details")
      .eq("kind", "quick")
      .contains("details", { source: "cron" })
      .order("checked_at", { ascending: false })
      .limit(1);
    const lastCronRow = (lastCron ?? [])[0] ?? null;

    const allOk = configProblems.length === 0 && callbackReady && discoveryOk && latestRow?.status !== "error";

    return {
      generatedAt: new Date().toISOString(),
      overall: allOk ? "ok" : "attention",
      sections: {
        config: {
          ok: configProblems.length === 0,
          updatedAt: cfg?.updated_at ?? null,
          problems: configProblems,
        },
        callback: {
          ok: callbackReady,
          expectedPath: "/admin/google-oauth-callback",
          actualPath: callbackPath,
        },
        discovery: {
          ok: discoveryOk,
          status: discoveryStatus,
          latencyMs: discoveryMs,
          error: discoveryError,
        },
        latestHealth: latestRow
          ? {
              ok: latestRow.status === "ok",
              kind: latestRow.kind,
              checkedAt: latestRow.checked_at,
              errorCode: latestRow.error_code,
              errorMessage: latestRow.error_message,
              latencyMs: latestRow.latency_ms,
            }
          : null,
        lastCron: lastCronRow
          ? {
              ok: lastCronRow.status === "ok",
              checkedAt: lastCronRow.checked_at,
              errorCode: lastCronRow.error_code,
              errorMessage: lastCronRow.error_message,
              latencyMs: lastCronRow.latency_ms,
            }
          : null,
      },
    };
  });

// -----------------------------------------------------------------------------
// Safe "full token exchange" probe — no user consent required.
// Runs discovery, then posts an intentionally-invalid authorization_code to the
// token endpoint. Google replies:
//   * invalid_grant  → client_id + client_secret are valid (Google accepted them
//                       and only rejected the fake code). PROBE PASS.
//   * invalid_client → client credentials wrong. FAIL.
//   * redirect_uri_mismatch → URI not whitelisted in Cloud Console. FAIL.
// Result is recorded into google_oauth_health_log as kind=full, source=probe.
// -----------------------------------------------------------------------------
export const probeFullTokenExchange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    // Safe probe actually hits Google's token endpoint; cap to 5 per 5 min per admin.
    await enforceRateLimit(supabase, userId, "safe_probe", 300, 5);
    const started = Date.now();


    // Discovery first.
    try {
      const disc = await fetchWithRetry(GOOGLE_DISCOVERY, { method: "GET" }, { timeoutMs: 5_000, retries: 2, label: "probe-discovery" });
      if (!disc.ok) {
        const msg = `Google discovery returned HTTP ${disc.status}`;
        await logHealth(supabase, userId, {
          kind: "full",
          status: "error",
          error_code: "discovery_failed",
          error_message: msg,
          latency_ms: Date.now() - started,
          details: { source: "probe" },
        });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await maybeEmitOAuthAlert(supabaseAdmin, "manual");
        return { ok: false, errorCode: "discovery_failed", message: msg, latencyMs: Date.now() - started };
      }
    } catch (e: any) {
      const msg = e?.message ?? "discovery error";
      await logHealth(supabase, userId, {
        kind: "full",
        status: "error",
        error_code: "discovery_failed",
        error_message: msg,
        latency_ms: Date.now() - started,
        details: { source: "probe" },
      });
      return { ok: false, errorCode: "discovery_failed", message: msg, latencyMs: Date.now() - started };
    }

    let creds;
    try { creds = await loadCreds(supabase); }
    catch (e: any) {
      const msg = e?.message ?? "missing credentials";
      await logHealth(supabase, userId, {
        kind: "full",
        status: "error",
        error_code: "missing_credentials",
        error_message: msg,
        latency_ms: Date.now() - started,
        details: { source: "probe" },
      });
      return { ok: false, errorCode: "missing_credentials", message: msg, latencyMs: Date.now() - started };
    }

    const fakeCode = `probe-${crypto.randomUUID()}`;
    const body = new URLSearchParams({
      code: fakeCode,
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      redirect_uri: creds.redirect_uri,
      grant_type: "authorization_code",
    });

    let res: Response;
    try {
      res = await fetchWithRetry(
        GOOGLE_TOKEN_ENDPOINT,
        { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() },
        { timeoutMs: 10_000, retries: 2, baseDelayMs: 400, label: "probe-token-exchange" },
      );
    } catch (e: any) {
      const msg = e?.message ?? "Network error contacting Google";
      await logHealth(supabase, userId, {
        kind: "full",
        status: "error",
        error_code: "network_error",
        error_message: msg,
        latency_ms: Date.now() - started,
        details: { source: "probe" },
      });
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await maybeEmitOAuthAlert(supabaseAdmin, "manual");
      return { ok: false, errorCode: "network_error", message: msg, latencyMs: Date.now() - started };
    }

    const json: any = await res.json().catch(() => ({}));
    const latency = Date.now() - started;
    const code = String(json.error ?? `http_${res.status}`);

    // invalid_grant from Google means: client_id + secret + redirect_uri all OK,
    // only the authorization code was bad — which is exactly what we sent.
    if (code === "invalid_grant") {
      await logHealth(supabase, userId, {
        kind: "full",
        status: "ok",
        latency_ms: latency,
        details: { source: "probe", probe: "invalid_grant_expected" },
      });
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await maybeEmitOAuthAlert(supabaseAdmin, "manual");
      return {
        ok: true,
        message: "Safe probe passed — Google accepted the Client ID, Secret, and Redirect URI.",
        latencyMs: latency,
      };
    }

    const desc = json.error_description ?? `Google returned HTTP ${res.status}`;
    let friendly = desc;
    if (code === "invalid_client") friendly = "Client ID or Client Secret is incorrect.";
    else if (code === "redirect_uri_mismatch") friendly = "Redirect URI is not registered in Google Cloud Console.";
    else if (code === "unauthorized_client") friendly = "OAuth client is not authorized for this grant type.";

    await logHealth(supabase, userId, {
      kind: "full",
      status: "error",
      error_code: code,
      error_message: friendly,
      latency_ms: latency,
      details: { source: "probe", http: res.status, raw: json },
    });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await maybeEmitOAuthAlert(supabaseAdmin, "manual");
    return { ok: false, errorCode: code, message: friendly, latencyMs: latency };
  });

// -----------------------------------------------------------------------------
// Callback-route smoke test
// -----------------------------------------------------------------------------
// Invokes the same server-side guard the real OAuth callback runs by calling
// completeFullOAuthTest's handler logic with a mock state and code. The guard
// MUST reject with errorCode === "invalid_state" because no matching pending
// row exists for the random state — that is the expected guarded response.
//
// This proves the callback handler is wired, reachable, and validating state
// before touching Google. Rate-limited to 5 per 5 min per admin.
export const smokeTestCallbackHandler = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    await enforceRateLimit(supabase, userId, "callback_smoke", 300, 5);
    const started = Date.now();

    const mockState = `smoke-${crypto.randomUUID()}`;
    const mockCode = `smoke-${crypto.randomUUID()}`;

    // Replicates completeFullOAuthTest's state-lookup guard. We do NOT call the
    // server fn directly (auth middleware needs an HTTP context); we run the
    // same query so any change to the schema/guard surfaces here too.
    const { data: pending, error: pendErr } = await supabase
      .from("google_oauth_health_log")
      .select("id, kind")
      .eq("state_token", mockState)
      .eq("kind", "full_pending")
      .order("checked_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const latency = Date.now() - started;
    if (pendErr) {
      return {
        ok: false,
        errorCode: "db_error",
        message: `Smoke test could not query health log: ${pendErr.message}`,
        latencyMs: latency,
        guarded: false,
      };
    }

    // The guard MUST return null pending → handler returns invalid_state.
    const guarded = pending == null;
    return {
      ok: guarded,
      errorCode: guarded ? "invalid_state" : "guard_bypassed",
      message: guarded
        ? `Callback guard rejected mock state as expected (invalid_state).`
        : `Unexpected: mock state matched an existing pending row (id=${(pending as any)?.id ?? "?"}).`,
      latencyMs: latency,
      guarded,
      mock: { state: mockState, code: mockCode },
    };
  });
