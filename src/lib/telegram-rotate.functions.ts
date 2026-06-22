// Telegram bot token rotation.
//
// Replaces the previous token (whether from app_settings or env) with a new
// one in a safe sequence:
//   1. Validate the new token with getMe (no side effects).
//   2. Call deleteWebhook on the OLD token so the previous bot stops
//      receiving updates and can no longer deliver files for this app.
//   3. Persist the new token to app_settings (takes precedence over env).
//   4. Re-register the webhook using the new token.
//
// If anything fails before step 3, the old token stays active. If step 4
// fails, the new token is already saved but the webhook is not registered —
// the admin can retry "Register / refresh webhook".
//
// We use direct fetch() against api.telegram.org here (not telegram-api.server)
// because we need to address two different tokens within a single call.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminAccess } from "@/lib/admin-auth";

async function callTgWithToken<T = any>(token: string, method: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json?.ok) {
    throw new Error(`Telegram ${method} failed: ${JSON.stringify(json?.description ?? json)}`);
  }
  return json.result as T;
}

export const rotateTelegramBotToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      newToken: z.string().trim().regex(/^\d+:[A-Za-z0-9_-]{20,}$/, "Token must look like 123456:ABC... from BotFather"),
      confirm: z.literal("ROTATE"),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getSetting } = await import("@/lib/runtime-settings.server");
    const { bumpSettingsVersion } = await import("@/lib/runtime-settings.server");

    const newToken = data.newToken;
    const oldToken = (await getSetting("TELEGRAM_BOT_TOKEN")) ?? process.env.TELEGRAM_BOT_TOKEN ?? null;

    // 1) Verify new token works (and is not the same bot).
    const newMe = await callTgWithToken<{ id: number; username?: string }>(newToken, "getMe");

    let oldMe: { id: number; username?: string } | null = null;
    if (oldToken && oldToken !== newToken) {
      try { oldMe = await callTgWithToken(oldToken, "getMe"); } catch { /* old token may already be revoked */ }
    }

    // 2) Tear down old webhook so the previous bot stops getting our updates.
    //    drop_pending_updates=true clears Telegram's queue for the old bot.
    let oldWebhookCleared: boolean | string = false;
    if (oldToken && oldToken !== newToken) {
      try {
        await callTgWithToken(oldToken, "deleteWebhook", { drop_pending_updates: true });
        oldWebhookCleared = true;
      } catch (e: any) {
        oldWebhookCleared = `failed: ${e?.message ?? String(e)}`;
      }
    } else if (oldToken === newToken) {
      oldWebhookCleared = "same token — skipped";
    }

    // 3) Persist new token. From this point on, all calls use the new bot.
    const { error: upErr } = await supabaseAdmin
      .from("app_settings")
      .upsert(
        {
          key: "TELEGRAM_BOT_TOKEN",
          value: newToken,
          is_secret: true,
          updated_by: context.userId,
          updated_at: new Date().toISOString(),
        } as never,
        { onConflict: "key" },
      );
    if (upErr) throw upErr;
    bumpSettingsVersion();

    // 4) Register webhook with the new bot.
    const base =
      (await getSetting("PUBLIC_BASE_URL")) ??
      process.env.PUBLIC_BASE_URL ??
      "";
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    let webhookResult: { ok: true; url: string } | { ok: false; error: string };
    if (!base) {
      webhookResult = { ok: false, error: "PUBLIC_BASE_URL is not configured — set it then click Register webhook." };
    } else if (!secret) {
      webhookResult = { ok: false, error: "TELEGRAM_WEBHOOK_SECRET is not configured." };
    } else {
      const url = `${base.replace(/\/$/, "")}/api/public/telegram/webhook`;
      try {
        await callTgWithToken(newToken, "setWebhook", {
          url,
          secret_token: secret,
          allowed_updates: ["message", "edited_message", "channel_post", "edited_channel_post"],
        });
        webhookResult = { ok: true, url };
      } catch (e: any) {
        webhookResult = { ok: false, error: e?.message ?? String(e) };
      }
    }

    // Audit
    try {
      await supabaseAdmin.from("admin_audit_log").insert({
        actor_user_id: context.userId,
        actor_email: (context.claims as any)?.email ?? null,
        action: "telegram.bot_token.rotate",
        status: webhookResult.ok ? "success" : "partial",
        metadata: {
          old_bot: oldMe ? { id: oldMe.id, username: oldMe.username } : null,
          new_bot: { id: newMe.id, username: newMe.username },
          old_webhook_cleared: oldWebhookCleared,
          webhook: webhookResult,
        },
      } as never);
    } catch (e) {
      console.warn("[rotate] audit insert failed", (e as Error).message);
    }

    return {
      ok: true,
      previousBot: oldMe ? { id: oldMe.id, username: oldMe.username } : null,
      newBot: { id: newMe.id, username: newMe.username },
      oldWebhookCleared,
      webhook: webhookResult,
    };
  });
