// Global rate-limit primitive backed by the `rate_limit_buckets` table and
// the `public.rl_hit` SECURITY DEFINER RPC. Uses fixed-window counters that
// are atomic at the database level (one row per (key, window_start)).
//
// Returned headers follow the IETF RateLimit draft (RFC 9331-style):
//   RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Retry-After.

import type { SupabaseClient } from "@supabase/supabase-js";

export type RateLimitInfo = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
  retryAfterSec: number;
};

export type RateLimitOpts = {
  key: string;
  limit: number;
  windowSec: number;
};

let _admin: SupabaseClient<any, any, any> | null = null;
async function admin(): Promise<SupabaseClient<any, any, any>> {
  if (_admin) return _admin;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  _admin = supabaseAdmin as unknown as SupabaseClient<any, any, any>;
  return _admin;
}

export async function consumeRateLimit(opts: RateLimitOpts): Promise<RateLimitInfo> {
  const sb = await admin();
  try {
    const { data, error } = await sb.rpc("rl_hit", {
      _key: opts.key,
      _window_sec: opts.windowSec,
      _limit: opts.limit,
    });
    if (error || !data || !(data as any[]).length) {
      // Fail-open: never let the limiter itself break the request, but log.
      console.warn("[rate-limit] rl_hit failed, allowing:", error?.message);
      const resetAt = new Date(Date.now() + opts.windowSec * 1000);
      return { allowed: true, limit: opts.limit, remaining: opts.limit, resetAt, retryAfterSec: 0 };
    }
    const row = (data as any[])[0];
    const used = Number(row.used);
    const lim = Number(row.lim);
    const resetAt = new Date(row.reset_at);
    const remaining = Math.max(0, lim - used);
    const retryAfterSec = Math.max(0, Math.ceil((resetAt.getTime() - Date.now()) / 1000));
    return { allowed: !!row.allowed, limit: lim, remaining, resetAt, retryAfterSec };
  } catch (e) {
    console.warn("[rate-limit] error, allowing:", (e as Error).message);
    const resetAt = new Date(Date.now() + opts.windowSec * 1000);
    return { allowed: true, limit: opts.limit, remaining: opts.limit, resetAt, retryAfterSec: 0 };
  }
}

export function rateLimitHeaders(info: RateLimitInfo): Record<string, string> {
  const h: Record<string, string> = {
    "RateLimit-Limit": String(info.limit),
    "RateLimit-Remaining": String(info.remaining),
    "RateLimit-Reset": String(info.retryAfterSec),
    "RateLimit-Policy": `${info.limit};w=${info.retryAfterSec || 60}`,
  };
  if (!info.allowed) h["Retry-After"] = String(info.retryAfterSec || 1);
  return h;
}

/** Build a 429 Response with the standard headers. */
export function rateLimited429(info: RateLimitInfo, message = "Too Many Requests"): Response {
  return new Response(JSON.stringify({ error: message, retryAfterSec: info.retryAfterSec }), {
    status: 429,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...rateLimitHeaders(info),
    },
  });
}

/** Apply headers to the current server-fn response and throw a Response on overflow. */
export async function enforceServerFnRateLimit(opts: RateLimitOpts): Promise<void> {
  const info = await consumeRateLimit(opts);
  const { setResponseHeader, setResponseStatus } = await import("@tanstack/react-start/server");
  for (const [k, v] of Object.entries(rateLimitHeaders(info))) {
    try { setResponseHeader(k, v); } catch { /* noop outside request */ }
  }
  if (!info.allowed) {
    try { setResponseStatus(429); } catch {}
    throw new Response(
      JSON.stringify({ error: "rate_limited", retryAfterSec: info.retryAfterSec }),
      { status: 429, headers: { "content-type": "application/json", ...rateLimitHeaders(info) } },
    );
  }
}

/** Best-effort client identifier from headers when no userId is available. */
export function clientIpFromHeaders(h: Headers): string {
  return (
    h.get("cf-connecting-ip") ??
    h.get("x-real-ip") ??
    (h.get("x-forwarded-for") ?? "").split(",")[0].trim() ??
    "unknown"
  );
}
