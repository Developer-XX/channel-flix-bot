// External-MTProto backfill ingest endpoint.
//
// The `scripts/telegram-backfill/` Node script logs into Telegram as a USER
// (not a bot), pages through channel history via gramjs, and POSTs each
// historical message here. Telegram's Bot API cannot read pre-join channel
// history, so this user-side backfill is the only way to import existing
// posts.
//
// Security: HMAC-SHA256 over the raw body, keyed with BACKFILL_SECRET. The
// script signs with the same secret. Requests with no signature or a
// mismatched signature are rejected 401.

import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

function safeEqual(a: string, b: string): boolean {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  if (A.length !== B.length) return false;
  return timingSafeEqual(A, B);
}

export const Route = createFileRoute("/api/public/telegram/backfill-ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.BACKFILL_SECRET;
        if (!secret) {
          console.error("[backfill-ingest] BACKFILL_SECRET not configured");
          return new Response("Server misconfigured", { status: 500 });
        }
        const sig = request.headers.get("x-backfill-signature") ?? "";
        const raw = await request.text();
        const expected = createHmac("sha256", secret).update(raw).digest("hex");
        if (!sig || !safeEqual(sig, expected)) {
          return new Response("Unauthorized", { status: 401 });
        }

        let payload: any;
        try {
          payload = JSON.parse(raw);
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        // Two shapes:
        //  { kind: "message", update: <synthetic TgUpdate> }
        //  { kind: "progress", channelId: number, cursor: number, ingested: number, status: "running"|"done"|"failed" }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        if (payload?.kind === "progress") {
          const channelId = Number(payload.channelId);
          if (!Number.isFinite(channelId)) return new Response("Bad channel id", { status: 400 });
          await supabaseAdmin
            .from("telegram_channels")
            .update({
              backfill_cursor: Number(payload.cursor) || null,
              backfill_ingested_count: Number(payload.ingested) || 0,
              backfill_last_run_at: new Date().toISOString(),
              backfill_status: String(payload.status ?? "running").slice(0, 32),
            })
            .eq("channel_id", channelId);
          return Response.json({ ok: true });
        }

        if (payload?.kind !== "message" || !payload.update) {
          return new Response("Unknown payload kind", { status: 400 });
        }

        const { ingestTelegramUpdate } = await import("@/lib/telegram-ingest.server");
        try {
          const result = await ingestTelegramUpdate(supabaseAdmin, payload.update, "backfill");
          return Response.json(result);
        } catch (e: any) {
          console.error("[backfill-ingest] error", e?.message);
          return Response.json({ ok: false, error: e?.message ?? "error" }, { status: 500 });
        }
      },
    },
  },
});
