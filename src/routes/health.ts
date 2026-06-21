// Deep health check for self-hosted Node SSR deployments.
// GET /health → { status, checks: { supabase, telegram, tmdb }, buildId, uptime }
// 200 if every dependency is reachable, 503 otherwise. Always no-cache.
import { createFileRoute } from "@tanstack/react-router";
import { BUILD_ID } from "@/build-id";
import { getSetting } from "@/lib/runtime-settings.server";

type Check = { ok: boolean; latency_ms: number; detail?: string };

async function timed<T>(fn: () => Promise<T>): Promise<{ value?: T; error?: string; ms: number }> {
  const start = Date.now();
  try {
    const value = await fn();
    return { value, ms: Date.now() - start };
  } catch (e) {
    return { error: (e as Error).message, ms: Date.now() - start };
  }
}

async function checkSupabase(): Promise<Check> {
  const { value, error, ms } = await timed(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Cheap auth-schema-free probe: list the first row of a tiny public table.
    const { error } = await supabaseAdmin.from("app_settings").select("key").limit(1);
    if (error) throw new Error(error.message);
    return true;
  });
  return { ok: !!value, latency_ms: ms, detail: error };
}

async function checkTelegram(): Promise<Check> {
  const { value, error, ms } = await timed(async () => {
    const token = await getSetting("TELEGRAM_BOT_TOKEN");
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN missing");
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: AbortSignal.timeout(4000),
    });
    const body = (await res.json()) as { ok?: boolean; description?: string };
    if (!res.ok || !body.ok) throw new Error(body.description || `HTTP ${res.status}`);
    return true;
  });
  return { ok: !!value, latency_ms: ms, detail: error };
}

async function checkTmdb(): Promise<Check> {
  const { value, error, ms } = await timed(async () => {
    const key = await getSetting("TMDB_API_KEY");
    if (!key) throw new Error("TMDB_API_KEY missing");
    const res = await fetch(`https://api.themoviedb.org/3/configuration?api_key=${key}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  });
  return { ok: !!value, latency_ms: ms, detail: error };
}

export const Route = createFileRoute("/health")({
  server: {
    handlers: {
      GET: async () => {
        const [supabase, telegram, tmdb] = await Promise.all([
          checkSupabase(),
          checkTelegram(),
          checkTmdb(),
        ]);
        const allOk = supabase.ok && telegram.ok && tmdb.ok;
        return Response.json(
          {
            status: allOk ? "ok" : "degraded",
            buildId: BUILD_ID,
            timestamp: new Date().toISOString(),
            uptime_s: Math.round(process.uptime?.() ?? 0),
            checks: { supabase, telegram, tmdb },
          },
          {
            status: allOk ? 200 : 503,
            headers: { "cache-control": "no-store, max-age=0" },
          },
        );
      },
    },
  },
});
