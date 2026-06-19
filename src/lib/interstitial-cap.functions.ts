// End-to-end server-side frequency cap for video interstitials.
//
// Two callers:
//   - signed-in user  → cap is anchored to user_id via ad_view_log
//   - anonymous user  → cap is anchored to a per-session httpOnly cookie
//                      and a salted IP hash (1h soft fallback)
//
// Both paths use SECURITY DEFINER Postgres functions that take an advisory
// lock and check+insert in one transaction, so two parallel requests cannot
// both "win" eligibility.
//
// Two-phase API (preview → claim) lets the UI know whether to even mount
// the interstitial without burning a slot if the user closes the tab
// mid-load. The actual cap row is only written on `claim_*` (called from
// VideoInterstitial onPlaying).

import { createServerFn } from "@tanstack/react-start";
import { setCookie, getCookie, getRequestIP, getRequestHeader } from "@tanstack/react-start/server";
import { createHash, randomBytes } from "crypto";
import { z } from "zod";
import { INTERSTITIAL_PLACEMENTS, type AdPlacement } from "@/lib/ads.functions";

const ANON_COOKIE = "int_sid";
const ANON_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days; cap window is 24h
const INTERSTITIAL_ENUM = z.enum(
  INTERSTITIAL_PLACEMENTS as unknown as [AdPlacement, ...AdPlacement[]],
);

type ClaimResult =
  | { claimed: true }
  | { claimed: false; reason?: "session_cap" | "ip_cap" | "user_cap"; nextAllowedAt: string | null };

function clientIp(): string {
  try {
    return getRequestIP({ xForwardedFor: true }) ?? "0.0.0.0";
  } catch {
    return "0.0.0.0";
  }
}

function userAgentClass(): string {
  const ua = (getRequestHeader("user-agent") ?? "").toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (/android/.test(ua)) return "android";
  if (/firefox/.test(ua)) return "firefox";
  if (/edg\//.test(ua)) return "edge";
  if (/safari/.test(ua)) return "safari";
  if (/chrome|chromium/.test(ua)) return "chrome";
  return "other";
}

async function ipSalt(): Promise<string> {
  try {
    const { getSetting } = await import("@/lib/runtime-settings.server");
    return (await getSetting("IP_HASH_SALT")) ?? "static-fallback-salt";
  } catch {
    return "static-fallback-salt";
  }
}

async function hashIp(ip: string): Promise<string> {
  const salt = await ipSalt();
  return createHash("sha256").update(`${ip}|${salt}`).digest("hex");
}

function ensureSessionCookie(): string {
  const existing = getCookie(ANON_COOKIE);
  if (existing && /^[A-Za-z0-9_-]{16,128}$/.test(existing)) return existing;
  const fresh = randomBytes(24).toString("base64url");
  setCookie(ANON_COOKIE, fresh, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: ANON_COOKIE_MAX_AGE,
  });
  return fresh;
}

async function getCurrentUserId(): Promise<string | null> {
  try {
    const auth = getRequestHeader("authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "");
    if (!token) return null;
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data } = await sb.auth.getUser(token);
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

// -- Preview eligibility (does NOT consume the slot) -----------------------
export const previewInterstitialEligibility = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ placement: INTERSTITIAL_ENUM }).parse(d))
  .handler(async ({ data }): Promise<{ eligible: boolean; nextAllowedAt: string | null }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = await getCurrentUserId();
    const sinceDay = new Date(Date.now() - 24 * 3600_000).toISOString();
    const sinceHour = new Date(Date.now() - 3600_000).toISOString();

    if (userId) {
      const { data: rows } = await supabaseAdmin
        .from("ad_view_log")
        .select("created_at")
        .eq("user_id", userId)
        .eq("placement", data.placement)
        .gte("created_at", sinceDay)
        .order("created_at", { ascending: false })
        .limit(1);
      if (rows && rows.length > 0) {
        const last = new Date(rows[0].created_at as string).getTime();
        return { eligible: false, nextAllowedAt: new Date(last + 24 * 3600_000).toISOString() };
      }
      return { eligible: true, nextAllowedAt: null };
    }

    const sid = ensureSessionCookie();
    const ipHash = await hashIp(clientIp());

    const sessionQ = supabaseAdmin
      .from("ad_view_log_anon")
      .select("created_at")
      .eq("session_id", sid)
      .eq("placement", data.placement)
      .gte("created_at", sinceDay)
      .order("created_at", { ascending: false })
      .limit(1);
    const ipQ = supabaseAdmin
      .from("ad_view_log_anon")
      .select("created_at")
      .eq("ip_hash", ipHash)
      .eq("placement", data.placement)
      .gte("created_at", sinceHour)
      .order("created_at", { ascending: false })
      .limit(1);
    const [sessionR, ipR] = await Promise.all([sessionQ, ipQ]);

    if (sessionR.data?.length) {
      const last = new Date(sessionR.data[0].created_at as string).getTime();
      return { eligible: false, nextAllowedAt: new Date(last + 24 * 3600_000).toISOString() };
    }
    if (ipR.data?.length) {
      const last = new Date(ipR.data[0].created_at as string).getTime();
      return { eligible: false, nextAllowedAt: new Date(last + 3600_000).toISOString() };
    }
    return { eligible: true, nextAllowedAt: null };
  });

// -- Atomic claim (CONSUMES the slot) -------------------------------------
export const claimInterstitialView = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        placement: INTERSTITIAL_ENUM,
        ad_id: z.string().uuid().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<ClaimResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = await getCurrentUserId();
    try {
      if (userId) {
        const { data: res } = await supabaseAdmin.rpc("claim_interstitial_view_user", {
          _user_id: userId,
          _placement: data.placement,
          _ad_id: data.ad_id ?? null,
        });
        const r = (res ?? { claimed: false }) as { claimed: boolean; next_allowed_at?: string };
        if (r.claimed) return { claimed: true };
        return { claimed: false, reason: "user_cap", nextAllowedAt: r.next_allowed_at ?? null };
      }
      const sid = ensureSessionCookie();
      const ipHash = await hashIp(clientIp());
      const ua = userAgentClass();
      const { data: res } = await supabaseAdmin.rpc("claim_interstitial_view_anon", {
        _session_id: sid,
        _ip_hash: ipHash,
        _placement: data.placement,
        _ad_id: data.ad_id ?? null,
        _ua: ua,
      });
      const r = (res ?? { claimed: false }) as {
        claimed: boolean;
        reason?: "session_cap" | "ip_cap";
        next_allowed_at?: string;
      };
      if (r.claimed) return { claimed: true };
      return {
        claimed: false,
        reason: r.reason ?? "session_cap",
        nextAllowedAt: r.next_allowed_at ?? null,
      };
    } catch {
      // Fail-open so telemetry/auth flows never break — frequency caps are
      // a soft guarantee, not a security boundary.
      return { claimed: true };
    }
  });
