// 24h token-verification gate. Rotates through admin-enabled providers using
// a per-user time window. Providers: adrinolinks, nanolinks, arolinks, linkpays.
// When the secret for a provider is missing OR no providers are enabled, we
// fall back to a "passthrough" stub that redirects directly to
// /api/public/v/<token>.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "crypto";
import { getPublicBaseUrl, getPublicBaseUrlAsync } from "./site-url.server";
import { getSetting, getSettingNumber } from "./runtime-settings.server";

export const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export type Provider = "nanolinks" | "adrinolinks" | "arolinks" | "linkpays";

type ProviderConfig = {
  name: Provider;
  host: string;
  enabledKey: string;
  apiKeyKey: string;
  defaultEnabled: boolean;
};

const PROVIDER_REGISTRY: ProviderConfig[] = [
  { name: "adrinolinks", host: "adrinolinks.in", enabledKey: "SHORTENER_ENABLED_ADRINOLINKS", apiKeyKey: "ADRINOLINKS_API_KEY", defaultEnabled: true },
  { name: "nanolinks",   host: "nanolinks.in",   enabledKey: "SHORTENER_ENABLED_NANOLINKS",   apiKeyKey: "NANOLINKS_API_KEY",   defaultEnabled: true },
  { name: "arolinks",    host: "arolinks.com",   enabledKey: "SHORTENER_ENABLED_AROLINKS",    apiKeyKey: "AROLINKS_API_KEY",    defaultEnabled: false },
  { name: "linkpays",    host: "linkpays.in",    enabledKey: "SHORTENER_ENABLED_LINKPAYS",    apiKeyKey: "LINKPAYS_API_KEY",    defaultEnabled: false },
];

async function isTruthySetting(key: string, fallback: boolean): Promise<boolean> {
  const v = await getSetting(key);
  if (v == null) return fallback;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

async function getEnabledProviders(): Promise<ProviderConfig[]> {
  const out: ProviderConfig[] = [];
  for (const p of PROVIDER_REGISTRY) {
    if (await isTruthySetting(p.enabledKey, p.defaultEnabled)) out.push(p);
  }
  return out;
}

// Pick the active provider for this rotation window. We bucket time into
// SHORTENER_ROTATION_HOURS-wide slots and offset by user id so different
// users don't all rotate at the same instant.
async function pickRotatedProvider(userId: string, lastProvider: string | null): Promise<Provider | null> {
  const enabled = await getEnabledProviders();
  if (enabled.length === 0) return null;
  if (enabled.length === 1) return enabled[0].name;
  const hours = Math.max(1, await getSettingNumber("SHORTENER_ROTATION_HOURS", 12));
  const slotMs = hours * 60 * 60 * 1000;
  // Stable per-user offset
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  const slot = Math.floor((Date.now() + (h % slotMs)) / slotMs);
  const candidate = enabled[slot % enabled.length].name;
  // Don't repeat the immediately previous one if possible
  if (candidate === lastProvider && enabled.length > 1) {
    return enabled[(slot + 1) % enabled.length].name;
  }
  return candidate;
}

// Back-compat helper used by some callers.
export function nextProvider(last: string | null | undefined): Provider {
  return last === "nanolinks" ? "adrinolinks" : "nanolinks";
}

export function siteOrigin(): string {
  return getPublicBaseUrl();
}

export function mintToken(): string {
  return randomBytes(18).toString("base64url");
}

export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return createHash("sha256").update(ip).digest("base64url").slice(0, 32);
}

async function getUserCreatedAt(
  supabase: SupabaseClient<any, any, any>,
  userId: string,
): Promise<Date | null> {
  // profiles table is created on signup via handle_new_user trigger.
  const { data } = await supabase
    .from("profiles")
    .select("created_at")
    .eq("id", userId)
    .maybeSingle();
  return data?.created_at ? new Date(data.created_at) : null;
}

// Returns ms remaining in grace window, or 0 if no grace / already expired.
export async function getGraceRemainingMs(
  supabase: SupabaseClient<any, any, any>,
  userId: string,
): Promise<number> {
  const days = await getSettingNumber("VERIFICATION_GRACE_DAYS", 0);
  if (days <= 0) return 0;
  const createdAt = await getUserCreatedAt(supabase, userId);
  if (!createdAt) return 0;
  const expiresAt = createdAt.getTime() + days * 24 * 60 * 60 * 1000;
  return Math.max(0, expiresAt - Date.now());
}

export async function getVerificationState(
  supabase: SupabaseClient<any, any, any>,
  userId: string,
): Promise<{ verified: boolean; expiresAt: string | null; lastProvider: string | null; graceRemainingMs?: number }> {
  const graceRemainingMs = await getGraceRemainingMs(supabase, userId);
  const { data } = await supabase
    .from("user_verifications")
    .select("expires_at, last_provider")
    .eq("user_id", userId)
    .maybeSingle();
  // Grace period: treat user as verified for the duration of the grace window.
  if (graceRemainingMs > 0) {
    const graceExpires = new Date(Date.now() + graceRemainingMs).toISOString();
    return {
      verified: true,
      expiresAt: data?.expires_at ?? graceExpires,
      lastProvider: data?.last_provider ?? null,
      graceRemainingMs,
    };
  }
  if (!data?.expires_at) return { verified: false, expiresAt: null, lastProvider: data?.last_provider ?? null, graceRemainingMs: 0 };
  const verified = new Date(data.expires_at).getTime() > Date.now();
  return { verified, expiresAt: data.expires_at, lastProvider: data.last_provider ?? null, graceRemainingMs: 0 };
}

async function readKey(provider: Provider): Promise<string | null> {
  const cfg = PROVIDER_REGISTRY.find((p) => p.name === provider);
  if (!cfg) return null;
  const raw = await getSetting(cfg.apiKeyKey);
  if (!raw || raw.length < 8) return null;
  return raw;
}

function keyFingerprint(key: string): string {
  return "sha256:" + createHash("sha256").update(key).digest("hex").slice(0, 12);
}

async function shorten(
  supabase: SupabaseClient<any, any, any>,
  userId: string,
  provider: Provider,
  longUrl: string,
): Promise<string> {
  const key = await readKey(provider);
  const startedAt = Date.now();
  if (!key) {
    await supabase.from("verification_provider_calls").insert({
      user_id: userId,
      provider,
      status: "no_key",
      short_url_returned: false,
    });
    console.warn(`[verification] ${provider} key missing — using passthrough`);
    return longUrl;
  }
  const fingerprint = keyFingerprint(key);
  const cfg = PROVIDER_REGISTRY.find((p) => p.name === provider)!;
  const u = new URL(`https://${cfg.host}/api`);
  u.searchParams.set("api", key);
  u.searchParams.set("url", longUrl);
  let httpStatus: number | null = null;
  try {
    const res = await fetch(u.toString());
    httpStatus = res.status;
    const json = await res.json().catch(() => ({}));
    const short = json?.shortenedUrl ?? json?.shortUrl ?? json?.short ?? json?.data?.url;
    if (typeof short === "string" && short.startsWith("http")) {
      await supabase.from("verification_provider_calls").insert({
        user_id: userId,
        provider,
        status: "ok",
        http_status: httpStatus,
        latency_ms: Date.now() - startedAt,
        key_fingerprint: fingerprint,
        short_url_returned: true,
      });
      console.info(`[verification] ${provider} ok (${fingerprint})`);
      return short;
    }
    await supabase.from("verification_provider_calls").insert({
      user_id: userId,
      provider,
      status: "fallback",
      http_status: httpStatus,
      latency_ms: Date.now() - startedAt,
      key_fingerprint: fingerprint,
      short_url_returned: false,
      error: "unexpected_response_shape",
    });
    console.warn(`[verification] ${provider} unexpected response (${fingerprint})`);
    return longUrl;
  } catch (e: any) {
    await supabase.from("verification_provider_calls").insert({
      user_id: userId,
      provider,
      status: "error",
      http_status: httpStatus,
      latency_ms: Date.now() - startedAt,
      key_fingerprint: fingerprint,
      short_url_returned: false,
      error: String(e?.message ?? e).slice(0, 300),
    });
    console.error(`[verification] ${provider} request failed (${fingerprint})`);
    return longUrl;
  }
}

export async function startVerificationForUser(args: {
  supabase: SupabaseClient<any, any, any>;
  userId: string;
  mediaFileId: string | null;
  ip: string | null;
}): Promise<{ provider: Provider; redirectUrl: string; token: string; expiresAt: string }> {
  const { supabase, userId, mediaFileId, ip } = args;
  const current = await getVerificationState(supabase, userId);
  const rotated = await pickRotatedProvider(userId, current.lastProvider);
  const provider: Provider = rotated ?? nextProvider(current.lastProvider);

  await supabase
    .from("verification_tokens")
    .update({ consumed_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("consumed_at", null);

  const token = mintToken();
  const ttlSeconds = await getSettingNumber("SHORTENER_TOKEN_TTL_SECONDS", 30 * 60);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  await supabase.from("verification_tokens").insert({
    token,
    user_id: userId,
    media_file_id: mediaFileId,
    provider,
    ip_hash: hashIp(ip),
    expires_at: expiresAt,
  });

  const baseUrl = await getPublicBaseUrlAsync();
  const longUrl = `${baseUrl}/api/public/v/${token}`;
  const redirectUrl = await shorten(supabase, userId, provider, longUrl);
  return { provider, redirectUrl, token, expiresAt };
}

export async function consumeToken(args: {
  supabase: SupabaseClient<any, any, any>;
  token: string;
  ip: string | null;
}): Promise<
  | { ok: true; userId: string; mediaFileId: string | null; provider: string }
  | { ok: false; reason: "not_found" | "expired" | "already_used" | "ip_mismatch" }
> {
  const { supabase, token, ip } = args;
  const { data: row } = await supabase
    .from("verification_tokens")
    .select("token, user_id, media_file_id, provider, expires_at, consumed_at, ip_hash")
    .eq("token", token)
    .maybeSingle();
  if (!row) return { ok: false, reason: "not_found" };
  if (row.consumed_at) return { ok: false, reason: "already_used" };
  if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, reason: "expired" };
  if (row.ip_hash && ip && hashIp(ip) !== row.ip_hash) {
    console.warn(`[verification] ip mismatch for token (soft-allow)`);
  }

  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS).toISOString();

  await supabase.from("verification_tokens").update({ consumed_at: nowIso }).eq("token", token);
  await supabase.from("user_verifications").upsert(
    {
      user_id: row.user_id,
      last_provider: row.provider,
      verified_at: nowIso,
      expires_at: expiresAt,
      verification_count: 1,
    },
    { onConflict: "user_id" },
  );
  try {
    await (supabase.rpc as any)("increment_verification_count", { _user_id: row.user_id });
  } catch { /* optional RPC */ }

  return {
    ok: true,
    userId: row.user_id,
    mediaFileId: row.media_file_id ?? null,
    provider: row.provider,
  };
}
