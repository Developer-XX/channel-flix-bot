import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";

// Telegram channel-post webhook receiver + DM command dispatcher.
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

const HELP_TEXT = `<b>StreamVault ingest bot</b>

I watch your Telegram channels and import posted media files into the catalog.

<b>Setup</b>
1. Add me as an <b>Administrator</b> of your channel (with "Read messages" — posting rights optional).
2. Open the admin panel → Telegram → <b>Channel wizard</b> and paste the channel @username or id.
3. Post a file with a clear caption, e.g. <code>Demon Slayer S01E02 1080p WEB-DL Hindi+English</code>.
4. I'll react with 👀 on the post and the row will show up under "unmatched" or "matched".

<b>Commands</b>
/start, /help — this message
/id — show your chat id (useful when adding /broadcast admins)
/status — bot health and last ingest count
/channels — list connected channels
/broadcast &lt;text&gt; — (admins only) send a message to every active channel`;

// Returns true if the Telegram user (by fromId) is a bot admin: either linked
// to a website account that has the `admin` role, or listed explicitly in
// telegram_bot_state.admin_telegram_user_ids (legacy fallback).
async function isBotAdmin(supabaseAdmin: any, fromId: number | undefined): Promise<boolean> {
  if (!fromId) return false;
  const { data: link } = await supabaseAdmin
    .from("telegram_user_links").select("user_id")
    .eq("telegram_user_id", fromId).maybeSingle();
  if (link?.user_id) {
    const { data: role } = await supabaseAdmin
      .from("user_roles").select("role")
      .eq("user_id", link.user_id).eq("role", "admin").maybeSingle();
    if (role) return true;
  }
  const { data: state } = await supabaseAdmin
    .from("telegram_bot_state").select("admin_telegram_user_ids")
    .eq("id", "global").maybeSingle();
  const admins: number[] = state?.admin_telegram_user_ids ?? [];
  return admins.includes(fromId);
}

async function handleCommand(
  update: any,
  supabaseAdmin: any,
): Promise<{ handled: true; reply?: string } | { handled: false }> {
  const msg = update.message ?? update.edited_message;
  if (!msg?.chat?.id || msg.chat.type !== "private") return { handled: false };
  const text: string = (msg.text ?? "").trim();
  if (!text.startsWith("/")) return { handled: false };

  const { sendMessage } = await import("@/lib/telegram-api.server");
  const [rawCmd, ...rest] = text.split(/\s+/);
  const cmd = rawCmd.split("@")[0].toLowerCase();
  const args = rest.join(" ");
  const chatId = msg.chat.id;
  const fromId: number | undefined = msg.from?.id;

  // Admin-only commands (operational visibility / broadcast).
  if (cmd === "/status" || cmd === "/channels" || cmd === "/broadcast") {
    if (!(await isBotAdmin(supabaseAdmin, fromId))) {
      await sendMessage(
        chatId,
        `❌ This command is admin-only. Your Telegram user id is <code>${fromId ?? "?"}</code>. ` +
        `Ask an existing admin to link your account on the website or add your id in the admin panel.`,
      );
      return { handled: true };
    }
  }


  switch (cmd) {
    case "/start":
    case "/help": {
      // Account-link flow: /start link_<CODE> binds the chatter's Telegram
      // user id to whichever website account generated the code.
      const linkArg = args.trim();
      if (cmd === "/start" && /^link_[A-Z0-9]{4,10}$/i.test(linkArg)) {
        const code = linkArg.slice(5).toUpperCase();
        const { data: row } = await supabaseAdmin
          .from("telegram_user_links")
          .select("user_id, link_code_expires_at")
          .eq("link_code", code)
          .maybeSingle();
        if (!row) {
          await sendMessage(chatId, "❌ This link code is invalid. Open the website, click Download, and try again.");
          return { handled: true };
        }
        if (row.link_code_expires_at && new Date(row.link_code_expires_at) < new Date()) {
          await sendMessage(chatId, "⌛ That code has expired. Please request a fresh one on the website.");
          return { handled: true };
        }
        await supabaseAdmin.from("telegram_user_links").update({
          telegram_user_id: fromId ?? null,
          telegram_username: msg.from?.username ?? null,
          telegram_first_name: msg.from?.first_name ?? null,
          link_code: null,
          link_code_expires_at: null,
          linked_at: new Date().toISOString(),
        }).eq("user_id", row.user_id);
        await sendMessage(chatId, `✅ Account linked! You can now click <b>Download</b> on the website and I'll send the file here.`);
        return { handled: true };
      }
      await sendMessage(chatId, HELP_TEXT);
      return { handled: true };
    }
    case "/whoami": {
      const { data: link } = await supabaseAdmin
        .from("telegram_user_links")
        .select("user_id, linked_at")
        .eq("telegram_user_id", fromId ?? 0)
        .maybeSingle();
      await sendMessage(
        chatId,
        link?.user_id
          ? `🔗 Linked to website user <code>${link.user_id}</code>\nSince: ${link.linked_at ?? "?"}`
          : "Not linked. Open the website, click Download, then come back here with the link code.",
      );
      return { handled: true };
    }
    case "/unlink": {
      const { data: link } = await supabaseAdmin
        .from("telegram_user_links")
        .select("user_id")
        .eq("telegram_user_id", fromId ?? 0)
        .maybeSingle();
      if (!link) {
        await sendMessage(chatId, "You weren't linked to any account.");
        return { handled: true };
      }
      await supabaseAdmin.from("telegram_user_links").update({
        telegram_user_id: null, telegram_username: null, telegram_first_name: null, linked_at: null,
      }).eq("user_id", link.user_id);
      await sendMessage(chatId, "🔓 Unlinked. You won't receive downloads here until you re-link from the website.");
      return { handled: true };
    }
    case "/id": {
      await sendMessage(
        chatId,
        `Your chat id: <code>${chatId}</code>\nYour user id: <code>${fromId ?? "?"}</code>`,
      );
      return { handled: true };
    }
    case "/status": {
      const [{ count: chanCount }, { count: ingestCount }, { data: state }] = await Promise.all([
        supabaseAdmin.from("telegram_channels").select("id", { count: "exact", head: true }).eq("is_active", true),
        supabaseAdmin.from("telegram_ingest").select("id", { count: "exact", head: true }),
        supabaseAdmin.from("telegram_bot_state").select("last_run_at, last_run_status, last_update_id").eq("id", "global").maybeSingle(),
      ]);
      await sendMessage(
        chatId,
        `<b>Bot status</b>\nActive channels: ${chanCount ?? 0}\nIngested rows: ${ingestCount ?? 0}\nLast backfill: ${state?.last_run_at ?? "never"} (${state?.last_run_status ?? "—"})\nLast update_id: ${state?.last_update_id ?? 0}`,
      );
      return { handled: true };
    }
    case "/channels": {
      const { data: chans } = await supabaseAdmin
        .from("telegram_channels")
        .select("name, username, channel_id, is_active")
        .order("created_at", { ascending: true });
      if (!chans?.length) {
        await sendMessage(chatId, "No channels configured yet. Use the admin panel → Channel wizard.");
        return { handled: true };
      }
      const lines = chans.map((c: any) =>
        `${c.is_active ? "🟢" : "⚪"} ${c.name ?? c.username ?? c.channel_id} (<code>${c.channel_id}</code>)`,
      );
      await sendMessage(chatId, `<b>Channels</b>\n${lines.join("\n")}`);
      return { handled: true };
    }
    case "/broadcast": {
      const { data: state } = await supabaseAdmin
        .from("telegram_bot_state")
        .select("admin_telegram_user_ids")
        .eq("id", "global")
        .maybeSingle();
      const admins: number[] = state?.admin_telegram_user_ids ?? [];
      if (!fromId || !admins.includes(fromId)) {
        await sendMessage(chatId, `❌ Not authorized. Ask an admin to add your Telegram user id (<code>${fromId ?? "?"}</code>) in the admin panel.`);
        return { handled: true };
      }
      if (!args) {
        await sendMessage(chatId, "Usage: /broadcast &lt;message&gt;");
        return { handled: true };
      }
      const { data: chans } = await supabaseAdmin
        .from("telegram_channels")
        .select("channel_id")
        .eq("is_active", true);
      let ok = 0, fail = 0;
      for (const c of chans ?? []) {
        try { await sendMessage(c.channel_id, args); ok++; }
        catch { fail++; }
      }
      await sendMessage(chatId, `📣 Broadcast complete: ${ok} sent, ${fail} failed.`);
      return { handled: true };
    }
    default: {
      await sendMessage(chatId, "Unknown command. Type /help for the list.");
      return { handled: true };
    }
  }
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

        // DM command dispatch (private chats only). Channel posts fall through
        // to the ingest pipeline.
        try {
          const cmd = await handleCommand(update, supabaseAdmin);
          if (cmd.handled) {
            console.log(`[telegram-webhook] command handled update_id=${update?.update_id}`);
            return Response.json({ ok: true, kind: "command" });
          }
        } catch (e: any) {
          console.error("[telegram-webhook] command error:", e?.message);
        }

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
