import { createFileRoute } from "@tanstack/react-router";

// Lightweight client-error sink. Rate-limited per request — best-effort only.
// We just structured-log so the worker log pipeline picks it up.
export const Route = createFileRoute("/api/public/client-errors")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as Record<string, unknown>;
          // eslint-disable-next-line no-console
          console.error(
            JSON.stringify({
              kind: "client_error",
              at: new Date().toISOString(),
              ua: request.headers.get("user-agent") ?? null,
              ...body,
            }),
          );
        } catch {
          /* ignore parse errors — never fail the client */
        }
        return new Response(null, { status: 204 });
      },
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: { "access-control-allow-origin": "*" },
        }),
    },
  },
});
