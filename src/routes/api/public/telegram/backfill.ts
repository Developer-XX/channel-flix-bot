import { createFileRoute } from "@tanstack/react-router";

// Scheduled backfill: polls Telegram's getUpdates from the last processed
// update_id and runs each missed update through the same idempotent ingest
// pipeline used by the realtime webhook.
//
// Auth: protected by the Supabase publishable key in the `apikey` header
// (the canonical /api/public cron pattern). Also accepts admin-triggered
// manual runs through the server function in src/lib/telegram.functions.ts.
//
// Note: a Telegram Bot can only see messages it received while a webhook was
// NOT active. After running backfill we leave the webhook untouched; this
// endpoint is a safety net for explicit catch-ups (e.g. after rotating the
// bot token, or after temporarily removing the webhook).

async function runBackfill(): Promise<{
  ok: boolean;
  processed: number;
  newLastUpdateId: number | null;
  results: Array<{ update_id: number; status: string }>;
  error?: string;
}> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("[telegram-backfill] TELEGRAM_BOT_TOKEN is not configured");
    return { ok: false, processed: 0, newLastUpdateId: null, results: [], error: "no_bot_token" };
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { ingestTelegramUpdate } = await import("@/lib/telegram-ingest.server");

  // Load offset
  const { data: state } = await supabaseAdmin
    .from("telegram_bot_state")
    .select("last_update_id")
    .eq("id", "global")
    .maybeSingle();
  const offset = (state?.last_update_id ?? 0) + 1;

  const url = new URL(`https://api.telegram.org/bot${token}/getUpdates`);
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("timeout", "0");
  url.searchParams.set("limit", "100");
  url.searchParams.set("allowed_updates", JSON.stringify(["channel_post", "edited_channel_post", "message", "edited_message"]));

  const res = await fetch(url.toString(), { method: "GET" });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || !body?.ok) {
    const msg = body?.description ?? `HTTP ${res.status}`;
    console.error(`[telegram-backfill] getUpdates failed: ${msg}`);
    await supabaseAdmin.from("telegram_bot_state")
      .update({ last_run_at: new Date().toISOString(), last_run_status: "error", last_run_error: msg })
      .eq("id", "global");
    return { ok: false, processed: 0, newLastUpdateId: null, results: [], error: msg };
  }

  const updates: any[] = body.result ?? [];
  const results: Array<{ update_id: number; status: string }> = [];
  let maxId = state?.last_update_id ?? 0;

  for (const u of updates) {
    try {
      const r = await ingestTelegramUpdate(supabaseAdmin, u, "backfill");
      results.push({ update_id: u.update_id, status: r.status });
    } catch (e: any) {
      console.error(`[telegram-backfill] update_id=${u.update_id} error`, e);
      results.push({ update_id: u.update_id, status: "error" });
    }
    if (typeof u.update_id === "number" && u.update_id > maxId) maxId = u.update_id;
  }

  await supabaseAdmin.from("telegram_bot_state")
    .update({
      last_update_id: maxId,
      last_run_at: new Date().toISOString(),
      last_run_status: "ok",
      last_run_error: null,
    })
    .eq("id", "global");

  console.log(`[telegram-backfill] processed=${updates.length} new_last_update_id=${maxId}`);
  return { ok: true, processed: updates.length, newLastUpdateId: maxId, results };
}

export const Route = createFileRoute("/api/public/telegram/backfill")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expectedKey = process.env.SUPABASE_PUBLISHABLE_KEY;
        const apiKey = request.headers.get("apikey") ?? request.headers.get("x-api-key") ?? "";
        if (!expectedKey || apiKey !== expectedKey) {
          console.warn("[telegram-backfill] reject: invalid apikey");
          return new Response("Unauthorized", { status: 401 });
        }
        const result = await runBackfill();
        return Response.json(result);
      },
    },
  },
});

// Re-export for the admin "Run now" button (called from a server function).
export { runBackfill };
