// Verification redirect diagnostics — exposes the configured public base URL,
// recent token mints, and recent provider calls so admins can spot broken
// domain configs and link-routing problems quickly.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type VerificationDiagnostics = {
  baseUrl: {
    url: string;
    source: "PUBLIC_BASE_URL" | "SITE_URL" | "PUBLIC_SITE_URL" | "fallback";
    fallback: string;
    isFallback: boolean;
    looksBroken: boolean;
  };
  recentTokens: Array<{
    token_prefix: string;
    provider: string;
    user_id: string;
    media_file_id: string | null;
    created_at: string;
    expires_at: string;
    consumed_at: string | null;
    age_minutes: number;
  }>;
  recentProviderCalls: Array<{
    id: string;
    provider: string;
    status: string;
    http_status: number | null;
    latency_ms: number | null;
    short_url_returned: boolean;
    error: string | null;
    created_at: string;
  }>;
  counters: {
    tokensLast24h: number;
    consumedLast24h: number;
    expiredLast24h: number;
    providerErrorsLast24h: number;
  };
};

export const getVerificationDiagnostics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<VerificationDiagnostics> => {
    const { supabase, userId } = context as any;

    // Caller must be an admin — diagnostics expose tokens for every user.
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden — admin role required");

    const { getPublicBaseUrlSource, isBrokenOrigin } = await import("@/lib/site-url.server");
    const src = getPublicBaseUrlSource();

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [tokensRes, callsRes, allTokensRes, errsRes] = await Promise.all([
      supabaseAdmin
        .from("verification_tokens")
        .select("token, user_id, media_file_id, provider, created_at, expires_at, consumed_at")
        .order("created_at", { ascending: false })
        .limit(25),
      supabaseAdmin
        .from("verification_provider_calls")
        .select("id, provider, status, http_status, latency_ms, short_url_returned, error, created_at")
        .order("created_at", { ascending: false })
        .limit(25),
      supabaseAdmin
        .from("verification_tokens")
        .select("token, consumed_at, expires_at", { count: "exact" })
        .gte("created_at", sinceIso),
      supabaseAdmin
        .from("verification_provider_calls")
        .select("id", { count: "exact", head: true })
        .neq("status", "ok")
        .gte("created_at", sinceIso),
    ]);

    const tokens = (tokensRes.data ?? []) as any[];
    const calls = (callsRes.data ?? []) as any[];
    const allTokens = (allTokensRes.data ?? []) as any[];

    const consumed = allTokens.filter((t) => t.consumed_at).length;
    const expired = allTokens.filter(
      (t) => !t.consumed_at && new Date(t.expires_at).getTime() < Date.now(),
    ).length;

    return {
      baseUrl: {
        url: src.url,
        source: src.source,
        fallback: src.fallback,
        isFallback: src.source === "fallback",
        looksBroken: isBrokenOrigin(src.url),
      },
      recentTokens: tokens.map((t) => ({
        token_prefix: String(t.token).slice(0, 6),
        provider: t.provider,
        user_id: t.user_id,
        media_file_id: t.media_file_id,
        created_at: t.created_at,
        expires_at: t.expires_at,
        consumed_at: t.consumed_at,
        age_minutes: Math.round((Date.now() - new Date(t.created_at).getTime()) / 60000),
      })),
      recentProviderCalls: calls,
      counters: {
        tokensLast24h: allTokensRes.count ?? allTokens.length,
        consumedLast24h: consumed,
        expiredLast24h: expired,
        providerErrorsLast24h: errsRes.count ?? 0,
      },
    };
  });
