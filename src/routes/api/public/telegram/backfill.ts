import { createFileRoute } from "@tanstack/react-router";

// Scheduled backfill endpoint. Called by pg_cron with the project's
// publishable key in the `apikey` header.

export const Route = createFileRoute("/api/public/telegram/backfill")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { checkCronAuth } = await import("@/lib/cron-auth.server");
        const auth = checkCronAuth(request);
        if (!auth.ok) {
          console.warn("[telegram-backfill] reject: invalid cron secret");
          return auth.response;
        }
        const { runTelegramBackfill } = await import("@/lib/telegram-backfill.server");
        const result = await runTelegramBackfill();
        return Response.json(result);
      },
    },
  },
});
