// Public beacon endpoint for server-validated interstitial perf metrics.
//
// Caller sends { request_id, phase, value? } via navigator.sendBeacon. The
// request_id is an unguessable UUID issued by `issueInterstitialRequest`
// and is auto-expired after 15 minutes by the RPC, so freshness + opacity
// act as the auth boundary (no signed payload required).
//
// Routes under /api/public/* bypass the published-site auth wall by design;
// we still validate input shape and silently drop unknown phases.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Phase = z.enum([
  "first_byte",
  "first_frame",
  "buffer_start",
  "buffer_end",
  "dropped_frame",
  "end",
  "error",
]);

const Body = z.object({
  request_id: z.string().uuid(),
  phase: Phase,
  value: z.number().int().min(0).max(100000).optional(),
});

export const Route = createFileRoute("/api/public/hooks/interstitial-beacon")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let parsed: z.infer<typeof Body>;
        try {
          const json = await request.json();
          parsed = Body.parse(json);
        } catch {
          return new Response("Bad Request", { status: 400 });
        }
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          await (supabaseAdmin as unknown as {
            rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>;
          }).rpc("record_interstitial_beacon", {
            _request_id: parsed.request_id,
            _phase: parsed.phase,
            _value: parsed.value ?? null,
          });
        } catch {
          /* swallow — telemetry must never break playback */
        }
        return new Response("ok", { status: 204 });
      },
      OPTIONS: async () => new Response(null, { status: 204 }),
    },
  },
});
