import { createFileRoute } from "@tanstack/react-router";
import { BUILD_ID } from "@/build-id";

export const Route = createFileRoute("/api/public/health")({
  server: {
    handlers: {
      GET: async () => {
        return Response.json(
          {
            status: "ok",
            buildId: BUILD_ID,
            timestamp: new Date().toISOString(),
            uptime:
              typeof process !== "undefined" && process.uptime
                ? Math.round(process.uptime())
                : null,
          },
          {
            headers: {
              "cache-control": "no-store, max-age=0",
            },
          },
        );
      },
    },
  },
});
