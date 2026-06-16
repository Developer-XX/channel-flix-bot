import { createServerFn } from "@tanstack/react-start";
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
  const key = process.env.TMDB_API_KEY;
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

async function checkShortener(name: string, envVar: string, host: string): Promise<CheckResult> {
  const key = process.env[envVar];
  if (!key) return { name, configured: false, ok: false, detail: `${envVar} not set` };
  try {
    // Quick health: hit the public host root — we don't burn API credit on a real shorten.
    // A 200/3xx/401 means DNS+TLS is fine, host is reachable.
    const { result, ms } = await timed(() =>
      fetch(`https://${host}/api?api=${encodeURIComponent(key)}&url=https://example.com&format=text`,
        { method: "GET" }),
    );
    const text = await result.text().catch(() => "");
    const ok = result.ok && /^https?:\/\//i.test(text.trim());
    return {
      name, configured: true, ok, latencyMs: ms,
      detail: ok ? `shortened OK (len=${text.trim().length})` : `HTTP ${result.status} ${text.slice(0, 80)}`,
    };
  } catch (e: any) {
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
      checkShortener("AdrinoLinks shortener", "ADRINOLINKS_API_KEY", "adrinolinks.com"),
      checkShortener("NanoLinks shortener", "NANOLINKS_API_KEY", "nanolinks.in"),
    ]);
    return { checks: [telegram, tmdb, adrino, nano], checkedAt: new Date().toISOString() };
  });
