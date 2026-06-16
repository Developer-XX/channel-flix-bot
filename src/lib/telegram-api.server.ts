// Thin wrappers around the Telegram Bot API. Server-only — uses TELEGRAM_BOT_TOKEN.

function token(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  return t;
}

async function callTg<T = any>(method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
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
