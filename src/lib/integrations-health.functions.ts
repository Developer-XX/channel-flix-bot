import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminAccess } from "@/lib/admin-auth";

type CheckResult = {
  name: string;
  configured: boolean;
  ok: boolean;
  detail: string;
  latencyMs?: number;
};

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const t0 = Date.now();
  const result = await fn();
  return { result, ms: Date.now() - t0 };
}

async function readKey(envVar: string): Promise<string | null> {
  // Runtime override (app_settings) wins, then process.env.
  try {
    const { getSetting } = await import("@/lib/runtime-settings.server");
    return await getSetting(envVar);
  } catch {
    return process.env[envVar] ?? null;
  }
}

async function checkTelegram(): Promise<CheckResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { name: "Telegram bot token", configured: false, ok: false, detail: "TELEGRAM_BOT_TOKEN not set" };
  try {
    const { result, ms } = await timed(() =>
      fetch(`https://api.telegram.org/bot${token}/getMe`, { method: "GET" }),
    );
    const json: any = await result.json().catch(() => ({}));
    if (!result.ok || !json?.ok) {
      return { name: "Telegram bot token", configured: true, ok: false, latencyMs: ms,
        detail: `HTTP ${result.status} ${json?.description ?? ""}`.trim() };
    }
    return { name: "Telegram bot token", configured: true, ok: true, latencyMs: ms,
      detail: `@${json.result?.username ?? "?"} (${json.result?.first_name ?? "bot"})` };
  } catch (e: any) {
    return { name: "Telegram bot token", configured: true, ok: false, detail: e?.message ?? "fetch failed" };
  }
}

async function checkTmdb(): Promise<CheckResult> {
  const key = await readKey("TMDB_API_KEY");
  if (!key) return { name: "TMDB API key", configured: false, ok: false, detail: "TMDB_API_KEY not set" };
  try {
    const { result, ms } = await timed(() =>
      fetch(`https://api.themoviedb.org/3/configuration?api_key=${encodeURIComponent(key)}`),
    );
    if (!result.ok) {
      return { name: "TMDB API key", configured: true, ok: false, latencyMs: ms, detail: `HTTP ${result.status}` };
    }
    const json: any = await result.json().catch(() => ({}));
    return { name: "TMDB API key", configured: true, ok: true, latencyMs: ms,
      detail: `images base: ${json?.images?.secure_base_url ?? "ok"}` };
  } catch (e: any) {
    return { name: "TMDB API key", configured: true, ok: false, detail: e?.message ?? "fetch failed" };
  }
}

async function logShortenerHealth(
  provider: string,
  ok: boolean,
  latencyMs: number,
  httpStatus: number | null,
  error: string | null,
) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("shortener_health_log").insert({
      provider, ok, latency_ms: latencyMs, http_status: httpStatus, error, source: "admin_check",
    } as never);
  } catch (e) {
    console.warn("[shortener-health] log insert failed", (e as Error).message);
  }
}

async function checkShortener(providerKey: "adrinolinks" | "nanolinks", name: string, envVar: string, host: string): Promise<CheckResult> {
  const key = await readKey(envVar);
  if (!key) {
    await logShortenerHealth(providerKey, false, 0, null, "no_key");
    return { name, configured: false, ok: false, detail: `${envVar} not set` };
  }
  try {
    const { result, ms } = await timed(() =>
      fetch(`https://${host}/api?api=${encodeURIComponent(key)}&url=https://example.com&format=text`,
        { method: "GET" }),
    );
    const text = await result.text().catch(() => "");
    const ok = result.ok && /^https?:\/\//i.test(text.trim());
    await logShortenerHealth(providerKey, ok, ms, result.status, ok ? null : text.slice(0, 200));
    return {
      name, configured: true, ok, latencyMs: ms,
      detail: ok ? `shortened OK (len=${text.trim().length})` : `HTTP ${result.status} ${text.slice(0, 80)}`,
    };
  } catch (e: any) {
    await logShortenerHealth(providerKey, false, 0, null, e?.message ?? "fetch_failed");
    return { name, configured: true, ok: false, detail: e?.message ?? "fetch failed" };
  }
}

export const runIntegrationsHealth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminAccess(context);
    const [telegram, tmdb, adrino, nano] = await Promise.all([
      checkTelegram(),
      checkTmdb(),
      checkShortener("adrinolinks", "AdrinoLinks shortener", "ADRINOLINKS_API_KEY", "adrinolinks.in"),
      checkShortener("nanolinks", "NanoLinks shortener", "NANOLINKS_API_KEY", "nanolinks.in"),
    ]);
    return { checks: [telegram, tmdb, adrino, nano], checkedAt: new Date().toISOString() };
  });

// Aggregated rolling health for the admin Diagnostics page.
export const getShortenerHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ provider: z.enum(["adrinolinks", "nanolinks"]).optional(), limit: z.number().int().min(1).max(200).optional() }).parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const providers: Array<"adrinolinks" | "nanolinks"> = data.provider ? [data.provider] : ["adrinolinks", "nanolinks"];
    const limit = data.limit ?? 50;

    const out: Array<{
      provider: string;
      status: "ok" | "warn" | "fail" | "unknown";
      lastCheckedAt: string | null;
      lastError: string | null;
      successRate: number;
      avgLatencyMs: number;
      samples: number;
      recent: Array<{ checked_at: string; ok: boolean; latency_ms: number | null; http_status: number | null; error: string | null }>;
    }> = [];

    for (const p of providers) {
      const { data: rows } = await supabaseAdmin
        .from("shortener_health_log")
        .select("checked_at, ok, latency_ms, http_status, error")
        .eq("provider", p)
        .order("checked_at", { ascending: false })
        .limit(limit);
      const r = (rows ?? []) as Array<{ checked_at: string; ok: boolean; latency_ms: number | null; http_status: number | null; error: string | null }>;
      const samples = r.length;
      const oks = r.filter((x) => x.ok).length;
      const successRate = samples ? oks / samples : 0;
      const avgLatencyMs = samples
        ? Math.round(r.reduce((acc, x) => acc + (x.latency_ms ?? 0), 0) / samples)
        : 0;
      const last = r[0] ?? null;
      const lastFail = r.find((x) => !x.ok) ?? null;
      let status: "ok" | "warn" | "fail" | "unknown" = "unknown";
      if (samples === 0) status = "unknown";
      else if (successRate >= 0.9) status = "ok";
      else if (successRate >= 0.5) status = "warn";
      else status = "fail";
      out.push({
        provider: p,
        status,
        lastCheckedAt: last?.checked_at ?? null,
        lastError: lastFail?.error ?? null,
        successRate,
        avgLatencyMs,
        samples,
        recent: r.slice(0, 10),
      });
    }
    return out;
  });
