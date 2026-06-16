import { createFileRoute } from "@tanstack/react-router";

// Scheduled backfill endpoint. Called by pg_cron with the project's
// publishable key in the `apikey` header.

export const Route = createFileRoute("/api/public/telegram/backfill")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expectedKey = process.env.SUPABASE_PUBLISHABLE_KEY;
        const apiKey =
          request.headers.get("apikey") ?? request.headers.get("x-api-key") ?? "";
        if (!expectedKey || apiKey !== expectedKey) {
          console.warn("[telegram-backfill] reject: invalid apikey");
          return new Response("Unauthorized", { status: 401 });
        }
        const { runTelegramBackfill } = await import("@/lib/telegram-backfill.server");
        const result = await runTelegramBackfill();
        return Response.json(result);
      },
    },
  },
});
