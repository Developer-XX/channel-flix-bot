// Cron-callable endpoint that evaluates Telegram sync health and emits
// admin alerts (in-admin + Telegram + email best-effort) when failure
// streaks or error-rate spikes are detected.
//
// Auth: apikey header (Supabase publishable/anon key) — matches the rest of
// the /api/public/hooks/* cron endpoints in this project.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/telegram-sync-alerts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
        if (!expected || apikey !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }
        try {
          const { evaluateTelegramSyncHealth } = await import("@/lib/telegram-sync-health.functions");
          const result = await evaluateTelegramSyncHealth({ source: "cron" });
          return Response.json({ ok: true, ...result });
        } catch (e: any) {
          return Response.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
        }
      },
    },
  },
});
