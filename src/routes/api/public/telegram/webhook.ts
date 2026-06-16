import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";

// Telegram channel-post webhook receiver.
// Security: Telegram is configured with a `secret_token` and sends it back in
// the `X-Telegram-Bot-Api-Secret-Token` header on every request. We compare it
// with a timing-safe equality check. Any mismatch is logged in detail and
// rejected with 401.

function safeEqual(a: string, b: string): boolean {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  if (A.length !== B.length) return false;
  return timingSafeEqual(A, B);
}

export const Route = createFileRoute("/api/public/telegram/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ip = request.headers.get("x-forwarded-for") ?? request.headers.get("cf-connecting-ip") ?? "?";
        const ua = request.headers.get("user-agent") ?? "?";

        const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
        if (!expectedSecret) {
          console.error("[telegram-webhook] TELEGRAM_WEBHOOK_SECRET is not configured");
          return new Response("Webhook secret not configured", { status: 500 });
        }

        const provided = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
        if (!provided) {
          console.warn(`[telegram-webhook] reject: missing secret header ip=${ip} ua=${ua}`);
          return new Response("Unauthorized: missing secret token", { status: 401 });
        }
        if (!safeEqual(provided, expectedSecret)) {
          console.warn(`[telegram-webhook] reject: invalid secret header ip=${ip} ua=${ua} provided_len=${provided.length}`);
          return new Response("Unauthorized: invalid secret token", { status: 401 });
        }

        let update: any;
        try {
          update = await request.json();
        } catch (e) {
          console.warn(`[telegram-webhook] reject: invalid JSON ip=${ip}`, e);
          return new Response("Bad request: invalid JSON", { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { ingestTelegramUpdate } = await import("@/lib/telegram-ingest.server");

        try {
          const result = await ingestTelegramUpdate(supabaseAdmin, update, "webhook");
          console.log(
            `[telegram-webhook] update_id=${update?.update_id} status=${result.status}` +
              ("matched" in result ? ` matched=${result.matched} score=${result.matchScore}` : "") +
              ("reason" in result ? ` reason=${result.reason}` : ""),
          );
          return Response.json(result);
        } catch (e: any) {
          console.error(`[telegram-webhook] error processing update_id=${update?.update_id}`, e);
          // Always 200 to Telegram so it doesn't hammer us with retries; the
          // event row in telegram_webhook_events records the failure.
          return Response.json({ ok: false, error: e?.message ?? "error" });
        }
      },
    },
  },
});
