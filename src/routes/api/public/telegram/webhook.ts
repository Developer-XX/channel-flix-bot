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

<b>Commands</b>
/start, /help — this message
/id — show your chat id
/status — bot health, ingest count, broadcast subscribers
/broadcast — (admins only) <b>forward a post</b> to me then <b>reply</b> /broadcast to send it to all bot users. Or use <code>/broadcast &lt;text&gt;</code> for a plain text blast.`;

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

async function captureSubscriber(supabaseAdmin: any, msg: any): Promise<void> {
  try {
    const fromId: number | undefined = msg?.from?.id;
    const chatId: number | undefined = msg?.chat?.id;
    if (!fromId || !chatId || msg?.chat?.type !== "private") return;
    await supabaseAdmin
      .from("telegram_broadcast_subscribers")
      .upsert(
        {
          telegram_user_id: fromId,
          chat_id: chatId,
          username: msg.from?.username ?? null,
          first_name: msg.from?.first_name ?? null,
          language_code: msg.from?.language_code ?? null,
          last_seen_at: new Date().toISOString(),
          blocked: false,
        },
        { onConflict: "telegram_user_id" },
      );
  } catch (e) {
    console.warn("[telegram-webhook] captureSubscriber failed:", (e as Error).message);
  }
}

async function runBroadcast(
  supabaseAdmin: any,
  args: {
    initiatedBy: string | null;
    source: { kind: "forwarded_copy"; fromChatId: number; messageId: number } | { kind: "text"; text: string };
    adminChatId: number;
  },
): Promise<{ ok: number; fail: number; total: number; runId: string | null }> {
  const { sendMessage, copyMessage } = await import("@/lib/telegram-api.server");
  const { data: subs } = await supabaseAdmin
    .from("telegram_broadcast_subscribers")
    .select("telegram_user_id, chat_id")
    .eq("blocked", false);
  const targets: Array<{ chat_id: number; telegram_user_id: number }> = subs ?? [];

  const { data: run } = await supabaseAdmin
    .from("telegram_broadcast_runs")
    .insert({
      initiated_by: args.initiatedBy,
      initiated_via: "bot",
      source_kind: args.source.kind,
      source_chat_id: args.source.kind === "forwarded_copy" ? args.source.fromChatId : null,
      source_msg_id: args.source.kind === "forwarded_copy" ? args.source.messageId : null,
      text_preview: args.source.kind === "text" ? args.source.text.slice(0, 280) : null,
      total_targets: targets.length,
    })
    .select("id")
    .single();
  const runId: string | null = run?.id ?? null;

  let ok = 0, fail = 0;
  let errorSample: string | null = null;
  const blockedIds: number[] = [];

  for (const t of targets) {
    try {
      if (args.source.kind === "forwarded_copy") {
        await copyMessage({
          toChatId: t.chat_id,
          fromChatId: args.source.fromChatId,
          messageId: args.source.messageId,
        });
      } else {
        await sendMessage(t.chat_id, args.source.text);
      }
      ok++;
    } catch (e: any) {
      fail++;
      const m = String(e?.message ?? e);
      if (!errorSample) errorSample = m.slice(0, 500);
      if (/bot was blocked|user is deactivated|chat not found/i.test(m)) {
        blockedIds.push(t.telegram_user_id);
      }
    }
    // Telegram rate limit ~30 msg/sec — keep well under
    await new Promise((r) => setTimeout(r, 45));
  }

  if (blockedIds.length) {
    try {
      await supabaseAdmin
        .from("telegram_broadcast_subscribers")
        .update({ blocked: true, blocked_at: new Date().toISOString() })
        .in("telegram_user_id", blockedIds);
    } catch {}
  }

  if (runId) {
    await supabaseAdmin
      .from("telegram_broadcast_runs")
      .update({
        success_count: ok,
        failed_count: fail,
        finished_at: new Date().toISOString(),
        error_sample: errorSample,
      })
      .eq("id", runId);
  }
  return { ok, fail, total: targets.length, runId };
}

async function handleCommand(
  update: any,
  supabaseAdmin: any,
): Promise<{ handled: true; reply?: string } | { handled: false }> {
  const msg = update.message ?? update.edited_message;
  if (!msg?.chat?.id || msg.chat.type !== "private") return { handled: false };

  // Capture every DM author into the broadcast subscriber list (even non-commands).
  await captureSubscriber(supabaseAdmin, msg);

  const text: string = (msg.text ?? msg.caption ?? "").trim();
  if (!text.startsWith("/")) return { handled: false };

  const { sendMessage } = await import("@/lib/telegram-api.server");
  const [rawCmd, ...rest] = text.split(/\s+/);
  const cmd = rawCmd.split("@")[0].toLowerCase();
  const args = rest.join(" ");
  const chatId = msg.chat.id;
  const fromId: number | undefined = msg.from?.id;

  // Admin-only commands (operational visibility / broadcast).
  if (cmd === "/status" || cmd === "/broadcast") {
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
      const [{ count: chanCount }, { count: ingestCount }, { count: subCount }, { data: state }] = await Promise.all([
        supabaseAdmin.from("telegram_channels").select("id", { count: "exact", head: true }).eq("is_active", true),
        supabaseAdmin.from("telegram_ingest").select("id", { count: "exact", head: true }),
        supabaseAdmin.from("telegram_broadcast_subscribers").select("telegram_user_id", { count: "exact", head: true }).eq("blocked", false),
        supabaseAdmin.from("telegram_bot_state").select("last_run_at, last_run_status, last_update_id").eq("id", "global").maybeSingle(),
      ]);
      await sendMessage(
        chatId,
        `<b>Bot status</b>\nActive channels: ${chanCount ?? 0}\nIngested rows: ${ingestCount ?? 0}\nBroadcast subscribers: ${subCount ?? 0}\nLast backfill: ${state?.last_run_at ?? "never"} (${state?.last_run_status ?? "—"})\nLast update_id: ${state?.last_update_id ?? 0}`,
      );
      return { handled: true };
    }
    case "/broadcast": {
      // Resolve linked website user (for audit trail).
      const { data: link } = await supabaseAdmin
        .from("telegram_user_links")
        .select("user_id")
        .eq("telegram_user_id", fromId ?? 0)
        .maybeSingle();
      const initiatedBy = link?.user_id ?? null;

      // Preferred path: admin REPLIES to a forwarded post with /broadcast.
      // We copy that exact source message to every subscriber.
      const reply = msg.reply_to_message;
      if (reply && reply.message_id && (reply.forward_from_chat?.id || reply.forward_from?.id || reply.chat?.id)) {
        const sourceFromChatId =
          reply.forward_from_chat?.id ?? reply.chat?.id;
        const sourceMessageId =
          reply.forward_from_message_id ?? reply.message_id;
        await sendMessage(chatId, "📣 Starting broadcast — copying the forwarded post to all subscribers…");
        const r = await runBroadcast(supabaseAdmin, {
          initiatedBy,
          source: { kind: "forwarded_copy", fromChatId: sourceFromChatId, messageId: sourceMessageId },
          adminChatId: chatId,
        });
        await sendMessage(
          chatId,
          `📣 Broadcast complete\n✅ Sent: ${r.ok}\n❌ Failed: ${r.fail}\n👥 Total subscribers: ${r.total}${r.runId ? `\nRun id: <code>${r.runId}</code>` : ""}`,
        );
        return { handled: true };
      }

      // Fallback: plain text broadcast (/broadcast Hello everyone).
      if (!args) {
        await sendMessage(
          chatId,
          "Usage:\n• <b>Forward a post to me, then reply</b> /broadcast — copies it to every subscriber.\n• <code>/broadcast &lt;text&gt;</code> — sends text to every subscriber.",
        );
        return { handled: true };
      }
      await sendMessage(chatId, "📣 Starting text broadcast to all subscribers…");
      const r = await runBroadcast(supabaseAdmin, {
        initiatedBy,
        source: { kind: "text", text: args },
        adminChatId: chatId,
      });
      await sendMessage(
        chatId,
        `📣 Broadcast complete\n✅ Sent: ${r.ok}\n❌ Failed: ${r.fail}\n👥 Total subscribers: ${r.total}${r.runId ? `\nRun id: <code>${r.runId}</code>` : ""}`,
      );
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

        // Replay protection: if we've already recorded this update_id, return
        // the previous outcome without re-running command dispatch or ingest.
        // Telegram retries failed deliveries; processing once-and-only-once
        // prevents duplicate sync rows, double-counted analytics, and
        // re-sent broadcasts.
        if (typeof update?.update_id === "number") {
          const { data: prior } = await supabaseAdmin
            .from("telegram_webhook_events")
            .select("status, processed_at")
            .eq("update_id", update.update_id)
            .maybeSingle();
          if (prior?.processed_at) {
            console.log(`[telegram-webhook] replay update_id=${update.update_id} prior_status=${prior.status}`);
            return Response.json({ ok: true, replay: true, status: prior.status });
          }
        }

        // Persist the raw update FIRST so Telegram can be ack'd immediately.
        // If our downstream ingest below times out or errors, the cron
        // `telegram-retry-pending-1min` will pick the row up and reprocess.
        // This is what stops caption edits from getting lost when the worker
        // is slow to respond (Telegram drops updates that time out).
        const chatId = update?.channel_post?.chat?.id
          ?? update?.edited_channel_post?.chat?.id
          ?? update?.message?.chat?.id
          ?? update?.edited_message?.chat?.id
          ?? 0;
        const messageId = update?.channel_post?.message_id
          ?? update?.edited_channel_post?.message_id
          ?? update?.message?.message_id
          ?? update?.edited_message?.message_id
          ?? 0;
        if (typeof update?.update_id === "number") {
          try {
            await supabaseAdmin.from("telegram_webhook_events").upsert({
              update_id: update.update_id,
              telegram_channel_id: chatId,
              telegram_message_id: messageId,
              source: "webhook",
              status: "received",
              raw_update: update,
            }, { onConflict: "update_id" });
          } catch (e: any) {
            console.warn("[telegram-webhook] persist raw_update failed:", e?.message);
          }
        }

        // DM command dispatch (private chats only). Channel posts fall through
        // to the ingest pipeline.
        try {
          const cmd = await handleCommand(update, supabaseAdmin);
          if (cmd.handled) {
            if (typeof update?.update_id === "number") {
              try {
                await supabaseAdmin.from("telegram_webhook_events")
                  .update({ status: "processed", processed_at: new Date().toISOString() })
                  .eq("update_id", update.update_id);
              } catch { /* ignore */ }
            }
            console.log(`[telegram-webhook] command handled update_id=${update?.update_id}`);
            return Response.json({ ok: true, kind: "command" });
          }
        } catch (e: any) {
          console.error("[telegram-webhook] command error:", e?.message);
        }

        const { ingestTelegramUpdate } = await import("@/lib/telegram-ingest.server");
        try {
          const result = await ingestTelegramUpdate(supabaseAdmin, update, "webhook");
          await supabaseAdmin.from("telegram_webhook_events")
            .update({ processed_at: new Date().toISOString() })
            .eq("update_id", update.update_id);
          console.log(
            `[telegram-webhook] update_id=${update?.update_id} status=${result.status}` +
              ("matched" in result ? ` matched=${result.matched} score=${result.matchScore}` : "") +
              ("reason" in result ? ` reason=${result.reason}` : ""),
          );
          return Response.json(result);
        } catch (e: any) {
          console.error(`[telegram-webhook] error processing update_id=${update?.update_id}`, e);
          // Always 200 to Telegram so it doesn't hammer us with retries; the
          // event row in telegram_webhook_events has raw_update + status='error',
          // and the retry cron will reprocess it.
          try {
            await supabaseAdmin.from("telegram_webhook_events")
              .update({
                status: "error",
                error: (e?.message ?? "error").toString().slice(0, 500),
                last_attempt_at: new Date().toISOString(),
                attempts: 1,
              })
              .eq("update_id", update.update_id);
          } catch {}
          return Response.json({ ok: false, error: e?.message ?? "error", will_retry: true });
        }
      },
    },
  },
});

