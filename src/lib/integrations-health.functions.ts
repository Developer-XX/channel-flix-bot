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

export type ShortenerProvider = "adrinolinks" | "nanolinks" | "arolinks" | "linkpays";

const SHORTENER_PROVIDERS: Array<{ id: ShortenerProvider; name: string; envVar: string; host: string }> = [
  { id: "adrinolinks", name: "AdrinoLinks shortener", envVar: "ADRINOLINKS_API_KEY", host: "adrinolinks.in" },
  { id: "nanolinks",   name: "NanoLinks shortener",   envVar: "NANOLINKS_API_KEY",   host: "nanolinks.in" },
  { id: "arolinks",    name: "AroLinks shortener",    envVar: "AROLINKS_API_KEY",    host: "arolinks.com" },
  { id: "linkpays",    name: "LinkPays shortener",    envVar: "LINKPAYS_API_KEY",    host: "linkpays.in" },
];

const ALL_IDS = SHORTENER_PROVIDERS.map((p) => p.id) as [ShortenerProvider, ...ShortenerProvider[]];

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const t0 = Date.now();
  const result = await fn();
  return { result, ms: Date.now() - t0 };
}

async function readKey(envVar: string): Promise<string | null> {
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
  source: string = "admin_check",
) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("shortener_health_log").insert({
      provider, ok, latency_ms: latencyMs, http_status: httpStatus, error, source,
    } as never);
  } catch (e) {
    console.warn("[shortener-health] log insert failed", (e as Error).message);
  }
}

async function checkShortener(providerKey: ShortenerProvider, name: string, envVar: string, host: string, source = "admin_check"): Promise<CheckResult> {
  const key = await readKey(envVar);
  if (!key) {
    await logShortenerHealth(providerKey, false, 0, null, "no_key", source);
    return { name, configured: false, ok: false, detail: `${envVar} not set` };
  }
  try {
    const { result, ms } = await timed(() =>
      fetch(`https://${host}/api?api=${encodeURIComponent(key)}&url=https://example.com&format=text`,
        { method: "GET" }),
    );
    const text = await result.text().catch(() => "");
    const ok = result.ok && /^https?:\/\//i.test(text.trim());
    await logShortenerHealth(providerKey, ok, ms, result.status, ok ? null : text.slice(0, 200), source);
    return {
      name, configured: true, ok, latencyMs: ms,
      detail: ok ? `shortened OK (len=${text.trim().length})` : `HTTP ${result.status} ${text.slice(0, 80)}`,
    };
  } catch (e: any) {
    await logShortenerHealth(providerKey, false, 0, null, e?.message ?? "fetch_failed", source);
    return { name, configured: true, ok: false, detail: e?.message ?? "fetch failed" };
  }
}

export const runIntegrationsHealth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminAccess(context);
    const shortenerResults = await Promise.all(
      SHORTENER_PROVIDERS.map((p) => checkShortener(p.id, p.name, p.envVar, p.host)),
    );
    const [telegram, tmdb] = await Promise.all([checkTelegram(), checkTmdb()]);
    return { checks: [telegram, tmdb, ...shortenerResults], checkedAt: new Date().toISOString() };
  });

// Aggregated rolling health for the admin Diagnostics page.
export const getShortenerHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      provider: z.enum(ALL_IDS).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }).parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const providers: ShortenerProvider[] = data.provider ? [data.provider] : SHORTENER_PROVIDERS.map((p) => p.id);
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
        provider: p, status,
        lastCheckedAt: last?.checked_at ?? null,
        lastError: lastFail?.error ?? null,
        successRate, avgLatencyMs, samples,
        recent: r.slice(0, 10),
      });
    }
    return out;
  });

// Probe a single shortener provider on demand and record it.
export const probeShortener = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ provider: z.enum(ALL_IDS) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const cfg = SHORTENER_PROVIDERS.find((p) => p.id === data.provider)!;
    const result = await checkShortener(data.provider, cfg.name, cfg.envVar, cfg.host);
    return { ...result, checkedAt: new Date().toISOString() };
  });

// CSV export of shortener_health_log for offline analysis.
export const exportShortenerHealthCsv = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ limit: z.number().int().min(1).max(10000).optional() }).parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("shortener_health_log")
      .select("checked_at, provider, ok, latency_ms, http_status, error, source")
      .order("checked_at", { ascending: false })
      .limit(data.limit ?? 5000);
    if (error) throw error;
    const header = "checked_at,provider,ok,latency_ms,http_status,error,source";
    const esc = (v: unknown) => {
      if (v === null || v === undefined) return "";
      const s = String(v).replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    };
    const lines = (rows ?? []).map((r: any) =>
      [r.checked_at, r.provider, r.ok, r.latency_ms, r.http_status, r.error, r.source].map(esc).join(","),
    );
    return { csv: [header, ...lines].join("\n"), rowCount: rows?.length ?? 0 };
  });

/**
 * Server-side helper for the rotation logic. Returns the set of provider ids
 * considered "healthy enough" to receive traffic, based on their most recent
 * sample in shortener_health_log. A provider with no samples is treated as
 * healthy (assume OK until proven otherwise).
 *
 * Unhealthy = last sample failed AND the failure is within the freshness window.
 */
export async function getHealthyShortenerSet(opts?: { freshnessMs?: number }): Promise<Set<string>> {
  const freshnessMs = opts?.freshnessMs ?? 30 * 60 * 1000;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sinceIso = new Date(Date.now() - freshnessMs).toISOString();
    const { data } = await supabaseAdmin
      .from("shortener_health_log")
      .select("provider, ok, checked_at")
      .gte("checked_at", sinceIso)
      .order("checked_at", { ascending: false })
      .limit(200);
    const last = new Map<string, { ok: boolean; checked_at: string }>();
    for (const row of (data ?? []) as Array<{ provider: string; ok: boolean; checked_at: string }>) {
      if (!last.has(row.provider)) last.set(row.provider, row);
    }
    const healthy = new Set<string>();
    for (const id of SHORTENER_PROVIDERS.map((p) => p.id)) {
      const r = last.get(id);
      // No fresh sample → assume healthy. Fresh sample → require ok=true.
      if (!r || r.ok) healthy.add(id);
    }
    return healthy;
  } catch {
    // If the health table can't be read, don't gate rotation on it.
    return new Set(SHORTENER_PROVIDERS.map((p) => p.id));
  }
}
