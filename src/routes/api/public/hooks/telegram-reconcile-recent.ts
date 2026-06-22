import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/telegram-reconcile-recent")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { checkCronAuth } = await import("@/lib/cron-auth.server");
        const auth = checkCronAuth(request);
        if (!auth.ok) return auth.response;

        const url = new URL(request.url);
        const hours = Math.max(1, Math.min(168, Number(url.searchParams.get("hours")) || 24));
        const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit")) || 250));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { reconcileRecentTelegramMedia } = await import("@/lib/telegram-ingest.server");
        const { recordTrace, newRunId } = await import("@/lib/sync-trace.server");
        const { bumpCacheVersion } = await import("@/lib/indexes.server");

        const runId = newRunId();
        await recordTrace({
          run_id: runId,
          source: "telegram-reconcile-recent",
          decision: "matched",
          reason_code: "RUN_STARTED",
          details: { hours, limit },
        });

        const result = await reconcileRecentTelegramMedia(supabaseAdmin, { sinceHours: hours, limit });
        if (result.updated > 0 || result.promoted > 0) await bumpCacheVersion(supabaseAdmin);

        await recordTrace({
          run_id: runId,
          source: "telegram-reconcile-recent",
          decision: result.errors.length ? "skipped" : "matched",
          reason_code: "RUN_FINISHED",
          details: result,
        });

        return Response.json({ ok: true, runId, ...result });
      },
    },
  },
});