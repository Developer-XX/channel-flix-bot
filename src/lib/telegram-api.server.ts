// Thin wrappers around the Telegram Bot API. Server-only.
// Token resolution: admin-editable app_settings TELEGRAM_BOT_TOKEN wins,
// falls back to the TELEGRAM_BOT_TOKEN env var.

async function token(): Promise<string> {
  const { getSetting } = await import("@/lib/runtime-settings.server");
  const fromDb = await getSetting("TELEGRAM_BOT_TOKEN");
  if (fromDb) return fromDb;
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  return t;
}

async function callTg<T = any>(method: string, body: Record<string, unknown>): Promise<T> {
  const t = await token();
  const res = await fetch(`https://api.telegram.org/bot${t}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) {
    throw new Error(`Telegram ${method} failed: ${JSON.stringify(json)}`);
  }
  return json.result as T;
}

export async function setWebhook(args: {
  url: string;
  secretToken: string;
  allowedUpdates?: string[];
}) {
  return callTg("setWebhook", {
    url: args.url,
    secret_token: args.secretToken,
    allowed_updates: args.allowedUpdates ?? ["message", "edited_message", "channel_post", "edited_channel_post"],
  });
}

export async function getWebhookInfo() {
  return callTg<{ url: string; pending_update_count: number; last_error_message?: string }>(
    "getWebhookInfo",
    {},
  );
}

export async function sendMessage(chatId: number | string, text: string, opts: Record<string, unknown> = {}) {
  return callTg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, ...opts });
}

export async function setMessageReaction(chatId: number | string, messageId: number, emoji: string) {
  try {
    return await callTg("setMessageReaction", {
      chat_id: chatId,
      message_id: messageId,
      reaction: [{ type: "emoji", emoji }],
      is_big: false,
    });
  } catch (e) {
    // Reactions can fail for many benign reasons (no permission, not allowed
    // emoji in this chat, etc). Log and swallow — never fail ingestion on it.
    console.warn("[telegram] setMessageReaction failed:", (e as Error).message);
    return null;
  }
}

export async function replyToMessage(chatId: number | string, messageId: number, text: string) {
  try {
    return await sendMessage(chatId, text, { reply_to_message_id: messageId, allow_sending_without_reply: true });
  } catch (e) {
    console.warn("[telegram] reply failed:", (e as Error).message);
    return null;
  }
}

export async function getMe() {
  return callTg<{ id: number; username?: string; first_name?: string }>("getMe", {});
}

export async function getChat(chatRef: string | number) {
  return callTg<{
    id: number;
    type: "private" | "group" | "supergroup" | "channel";
    title?: string;
    username?: string;
    description?: string;
  }>("getChat", { chat_id: chatRef });
}

export async function getChatMember(chatId: string | number, userId: number) {
  return callTg<{
    status: "creator" | "administrator" | "member" | "restricted" | "left" | "kicked";
    can_post_messages?: boolean;
    can_edit_messages?: boolean;
    can_delete_messages?: boolean;
    can_manage_chat?: boolean;
  }>("getChatMember", { chat_id: chatId, user_id: userId });
}

// Forwards/copies a previously-posted channel message into another chat
// (e.g. the user's DM). This is how we deliver files to website users
// without re-uploading — Telegram already has them in the source channel.
export async function copyMessage(args: {
  toChatId: number | string;
  fromChatId: number | string;
  messageId: number;
  caption?: string;
}) {
  return callTg<{ message_id: number }>("copyMessage", {
    chat_id: args.toChatId,
    from_chat_id: args.fromChatId,
    message_id: args.messageId,
    ...(args.caption ? { caption: args.caption, parse_mode: "HTML" } : {}),
  });
}

// Best-effort: returns null on common "bot can't DM the user" cases so the
// caller can show a helpful "press Start in the bot first" message.
export async function tryCopyMessage(args: Parameters<typeof copyMessage>[0]):
  Promise<{ ok: true; messageId: number } | { ok: false; error: string; kind: "blocked" | "not_started" | "not_found" | "other" }> {
  try {
    const r = await copyMessage(args);
    return { ok: true, messageId: r.message_id };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    let kind: "blocked" | "not_started" | "not_found" | "other" = "other";
    if (/bot was blocked/i.test(msg)) kind = "blocked";
    else if (/chat not found|user not found/i.test(msg)) kind = "not_started";
    else if (/message to copy not found|MESSAGE_ID_INVALID/i.test(msg)) kind = "not_found";
    return { ok: false, error: msg, kind };
  }
}
