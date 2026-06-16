// 24h token-verification gate. Alternates providers per cycle.
// Providers: nanolinks → adrinolinks → nanolinks → ...
// When the secret for a provider is missing, we fall back to a "passthrough"
// stub that redirects directly to /api/public/v/<token> — handy for local
// testing and for the first run before keys are added.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "crypto";

export const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export type Provider = "nanolinks" | "adrinolinks";

export function nextProvider(last: string | null | undefined): Provider {
  return last === "nanolinks" ? "adrinolinks" : "nanolinks";
}

function siteOrigin(): string {
  return (
    process.env.SITE_URL ??
    process.env.PUBLIC_SITE_URL ??
    "https://channel-flix-bot.lovable.app"
  );
}

export function mintToken(): string {
  return randomBytes(18).toString("base64url");
}

export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return createHash("sha256").update(ip).digest("base64url").slice(0, 32);
}

export async function getVerificationState(
  supabase: SupabaseClient<any, any, any>,
  userId: string,
): Promise<{ verified: boolean; expiresAt: string | null; lastProvider: string | null }> {
  const { data } = await supabase
    .from("user_verifications")
    .select("expires_at, last_provider")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data?.expires_at) return { verified: false, expiresAt: null, lastProvider: data?.last_provider ?? null };
  const verified = new Date(data.expires_at).getTime() > Date.now();
  return { verified, expiresAt: data.expires_at, lastProvider: data.last_provider ?? null };
}

// Read shortener API keys ONLY from server env. Never logged, never returned
// to the client. We expose a stable, non-reversible fingerprint for audit.
function readKey(provider: Provider): string | null {
  const raw =
    provider === "nanolinks"
      ? process.env.NANOLINKS_API_KEY
      : process.env.ADRINOLINKS_API_KEY;
  if (!raw || raw.length < 8) return null;
  return raw;
}

function keyFingerprint(key: string): string {
  return "sha256:" + createHash("sha256").update(key).digest("hex").slice(0, 12);
}

// Shorten a URL through a provider. Returns the original URL if no key is
// configured (passthrough stub) so end-to-end flow still works.
async function shorten(
  supabase: SupabaseClient<any, any, any>,
  userId: string,
  provider: Provider,
  longUrl: string,
): Promise<string> {
  const key = readKey(provider);
  const startedAt = Date.now();
  if (!key) {
    // Audit no-key path (passthrough)
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
  const host = provider === "nanolinks" ? "nanolinks.in" : "adrinolinks.in";
  const u = new URL(`https://${host}/api`);
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
      // Never log the key or full URL with the key embedded.
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
  const provider = nextProvider(current.lastProvider);

  // Invalidate any outstanding unconsumed tokens for this user
  await supabase
    .from("verification_tokens")
    .update({ consumed_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("consumed_at", null);

  const token = mintToken();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30min TTL
  await supabase.from("verification_tokens").insert({
    token,
    user_id: userId,
    media_file_id: mediaFileId,
    provider,
    ip_hash: hashIp(ip),
    expires_at: expiresAt,
  });

  const longUrl = `${siteOrigin()}/api/public/v/${token}`;
  const redirectUrl = await shorten(supabase, userId, provider, longUrl);
  return { provider, redirectUrl, token, expiresAt };
}

// Token consume — called by GET /api/public/v/:token.
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
  // Soft IP check — only enforce if both are present
  if (row.ip_hash && ip && hashIp(ip) !== row.ip_hash) {
    // Don't hard-fail; mobile carriers rotate IPs. Log for debugging.
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
  // Best-effort count bump
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
