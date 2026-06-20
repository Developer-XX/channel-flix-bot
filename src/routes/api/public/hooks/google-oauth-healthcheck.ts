// Cron endpoint: runs the Google OAuth health check on a schedule.
// Uses the same shared cron-auth pattern as the other hooks in this folder.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/google-oauth-healthcheck")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { checkCronAuth } = await import("@/lib/cron-auth.server");
        const auth = checkCronAuth(request);
        if (!auth.ok) return auth.response;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runCronHealthCheck } = await import("@/lib/google-oauth-admin.functions");

        try {
          const result = await runCronHealthCheck(supabaseAdmin);
          return Response.json({
            ok: result.ok,
            errorCode: result.errorCode ?? null,
            latencyMs: result.latencyMs,
            checkedAt: new Date().toISOString(),
          });
        } catch (e: any) {
          // Credentials missing or DB error — never throw, return a clean response.
          return Response.json(
            { ok: false, errorCode: "exception", message: e?.message ?? "Unknown error" },
            { status: 200 },
          );
        }
      },
    },
  },
});
