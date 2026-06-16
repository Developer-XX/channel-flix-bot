// Server functions for the bot-DM file delivery flow and Telegram account
// linking. The /api/public/telegram/webhook route is responsible for
// consuming the link codes generated here.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function randomCode(): string {
  // 6 chars, no ambiguous letters
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export const getMyTelegramLink = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("telegram_user_links")
      .select("telegram_user_id, telegram_username, telegram_first_name, linked_at, link_code, link_code_expires_at")
      .eq("user_id", context.userId)
      .maybeSingle();
    let botUsername: string | null = null;
    try {
      const { getMe } = await import("@/lib/telegram-api.server");
      const me = await getMe();
      botUsername = me.username ?? null;
    } catch {}
    return { link: data ?? null, botUsername };
  });

// Generates (or refreshes) a 6-character code the user pastes into Telegram
// via /start link_<code>. Codes expire in 15 minutes.
export const requestLinkCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Generate a unique-enough code; retry once on the (extremely rare) collision.
    let code = randomCode();
    const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const { error } = await supabaseAdmin
      .from("telegram_user_links")
      .upsert(
        { user_id: context.userId, link_code: code, link_code_expires_at: expires },
        { onConflict: "user_id" },
      );
    if (error) {
      code = randomCode();
      await supabaseAdmin
        .from("telegram_user_links")
        .upsert(
          { user_id: context.userId, link_code: code, link_code_expires_at: expires },
          { onConflict: "user_id" },
        );
    }
    let botUsername: string | null = null;
    try {
      const { getMe } = await import("@/lib/telegram-api.server");
      const me = await getMe();
      botUsername = me.username ?? null;
    } catch {}
    return { code, expiresAt: expires, botUsername };
  });

export const unlinkTelegram = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("telegram_user_links")
      .update({
        telegram_user_id: null,
        telegram_username: null,
        telegram_first_name: null,
        linked_at: null,
      })
      .eq("user_id", context.userId);
    return { ok: true };
  });

// Click "Download" on a file → bot DMs the user with the file via copyMessage.
// Requires telegram_user_links.telegram_user_id to be set (account linked).
export const requestDownload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ mediaFileId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1. Resolve the file + its source channel/message
    const { data: file, error: fileErr } = await supabaseAdmin
      .from("media_files")
      .select("id, file_name, title_id, telegram_message_id, channel_id, telegram_channels(channel_id, name)")
      .eq("id", data.mediaFileId)
      .maybeSingle();
    if (fileErr) throw fileErr;
    if (!file) return { ok: false as const, reason: "file_not_found" as const };
    if (!file.telegram_message_id || !(file as any).telegram_channels?.channel_id) {
      return { ok: false as const, reason: "source_missing" as const };
    }

    // 2. Resolve the user's linked Telegram id
    const { data: link } = await supabaseAdmin
      .from("telegram_user_links")
      .select("telegram_user_id, telegram_username")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!link?.telegram_user_id) {
      return { ok: false as const, reason: "not_linked" as const };
    }

    // 3. Forward the file via Bot API copyMessage
    const { tryCopyMessage } = await import("@/lib/telegram-api.server");
    const result = await tryCopyMessage({
      toChatId: link.telegram_user_id,
      fromChatId: (file as any).telegram_channels.channel_id,
      messageId: file.telegram_message_id,
      caption: `📥 ${file.file_name ?? "Your file"}\nDelivered by StreamVault`,
    });

    // 4. Log the delivery attempt
    const logRow = {
      user_id: context.userId,
      file_id: file.id,
      title_id: file.title_id,
      source: "bot_dm",
      delivery_status: result.ok ? "delivered" : result.kind,
      delivery_error: result.ok ? null : result.error.slice(0, 500),
      delivered_at: result.ok ? new Date().toISOString() : null,
    };
    await supabaseAdmin.from("download_logs").insert(logRow);

    if (result.ok) return { ok: true as const, delivered: true, messageId: result.messageId };
    if (result.kind === "blocked" || result.kind === "not_started") {
      return { ok: false as const, reason: "bot_blocked" as const };
    }
    if (result.kind === "not_found") {
      return { ok: false as const, reason: "source_missing" as const };
    }
    return { ok: false as const, reason: "delivery_failed" as const, error: result.error };
  });
