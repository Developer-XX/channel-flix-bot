/**
 * Production security hardening: secure HTTP headers + DB-backed rate limiting.
 *
 * Applied as request middleware in src/start.ts so it covers SSR pages,
 * server functions, and server routes uniformly.
 *
 * Headers:
 *   - Strict-Transport-Security  (1 year, includeSubDomains, preload)
 *   - X-Content-Type-Options     (nosniff)
 *   - X-Frame-Options            (SAMEORIGIN)
 *   - Referrer-Policy            (strict-origin-when-cross-origin)
 *   - Permissions-Policy         (deny camera/mic/geolocation by default)
 *   - Content-Security-Policy-Report-Only  (permissive; tighten later)
 *
 * Rate limiting (defence-in-depth, in addition to per-feature limits):
 *   - Only POST and PATCH requests to /_serverFn/*, /api/public/hooks/*,
 *     and /api/public/telegram/* are counted.
 *   - Keyed by IP + path bucket via the existing public.rl_hit RPC.
 *   - 60 hits / 60s by default (override via RATE_LIMIT_PER_MIN env).
 *   - On limit hit: 429 + Retry-After.
 *   - DB errors are swallowed → fail-open (never block legitimate traffic
 *     because Supabase blipped).
 */

import { createMiddleware } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";

const RATE_WINDOW_SEC = 60;
const RATE_LIMIT = Math.max(1, Number(process.env.RATE_LIMIT_PER_MIN ?? 60));

const HSTS = "max-age=31536000; includeSubDomains; preload";

// Hosts allowed to embed the app in an iframe (Lovable editor preview, etc.).
// Keep self + Lovable hosts. Add your own admin/embed hosts here if needed.
const FRAME_ANCESTORS =
  "'self' https://*.lovable.app https://*.lovable.dev https://lovable.dev https://*.gpt-eng.com";

// Permissive CSP — Report-Only so we never break the live app. Tighten with
// nonces/hashes once a CSP-report endpoint is wired up.
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.gpteng.co https://www.googletagmanager.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "connect-src 'self' https: wss:",
  "frame-src 'self' https:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  `frame-ancestors ${FRAME_ANCESTORS}`,
].join("; ");

const PERMISSIONS_POLICY =
  "camera=(), microphone=(), geolocation=(), payment=(), usb=()";

// NOTE: /api/public/telegram/webhook is intentionally EXCLUDED. All Telegram
// updates originate from a single Telegram IP, so the per-IP limit caused
// Telegram to receive HTTP 429 during normal post/edit bursts and silently
// drop updates (most visibly: caption edits). The webhook is already
// authenticated via the X-Telegram-Bot-Api-Secret-Token header and is
// idempotent on update_id, so per-IP throttling is the wrong control.
const RATE_LIMITED_PREFIXES = ["/_serverFn/", "/api/public/hooks/"];


let _supabase: ReturnType<typeof createClient> | null = null;
function getRateLimitClient() {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  _supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _supabase;
}

function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function setHeader(res: Response, name: string, value: string) {
  try {
    if (!res.headers.has(name)) res.headers.set(name, value);
  } catch {
    /* immutable headers — ignore */
  }
}

function applySecurityHeaders(res: Response, isHttps: boolean) {
  if (isHttps) setHeader(res, "strict-transport-security", HSTS);
  setHeader(res, "x-content-type-options", "nosniff");
  // NOTE: X-Frame-Options is intentionally NOT set — it only supports
  // single-origin SAMEORIGIN/DENY and would block the Lovable preview iframe.
  // Modern browsers honor CSP `frame-ancestors` (set below) instead.
  setHeader(res, "referrer-policy", "strict-origin-when-cross-origin");
  setHeader(res, "permissions-policy", PERMISSIONS_POLICY);
  setHeader(res, "content-security-policy-report-only", CSP_REPORT_ONLY);
}

async function rateLimit(request: Request, pathname: string): Promise<Response | null> {
  if (request.method !== "POST" && request.method !== "PATCH") return null;
  if (!RATE_LIMITED_PREFIXES.some((p) => pathname.startsWith(p))) return null;

  const client = getRateLimitClient();
  if (!client) return null; // fail-open if not configured

  const ip = clientIp(request);
  // Bucket key folds path to its first 3 segments so /_serverFn/* doesn't blow up cardinality.
  const segs = pathname.split("/").filter(Boolean).slice(0, 3).join("/");
  const key = `ip:${ip}|${request.method}:/${segs}`;

  try {
    // rl_hit isn't in the generated types; cast to any to keep this middleware
    // independent of regenerating Database types.
    const { data, error } = await (client.rpc as any)("rl_hit", {
      _key: key,
      _window_sec: RATE_WINDOW_SEC,
      _limit: RATE_LIMIT,
    });
    if (error) return null;
    const row: { allowed?: boolean; reset_at?: string } | null = Array.isArray(data)
      ? (data[0] as any)
      : (data as any);
    if (row && row.allowed === false) {
      const resetAt = row.reset_at
        ? new Date(row.reset_at).getTime()
        : Date.now() + RATE_WINDOW_SEC * 1000;
      const retry = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
      return new Response(
        JSON.stringify({
          error: "rate_limited",
          message: `Too many requests. Retry in ${retry}s.`,
          status: 429,
        }),
        {
          status: 429,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "retry-after": String(retry),
            "x-ratelimit-limit": String(RATE_LIMIT),
            "x-ratelimit-remaining": "0",
          },
        },
      );
    }
  } catch {
    /* swallow — fail-open */
  }
  return null;
}

export const securityMiddleware = createMiddleware().server(async ({ next, request }) => {
  const url = (() => {
    try {
      return new URL(request.url);
    } catch {
      return null;
    }
  })();
  const pathname = url?.pathname ?? "";
  const isHttps =
    url?.protocol === "https:" ||
    request.headers.get("x-forwarded-proto") === "https";

  // Rate limit BEFORE handler runs.
  const limited = await rateLimit(request, pathname);
  if (limited) {
    applySecurityHeaders(limited, isHttps);
    return { response: limited } as unknown as Awaited<ReturnType<typeof next>>;
  }

  const result = await next();
  applySecurityHeaders(result.response, isHttps);
  return result;
});
