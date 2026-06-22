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

export async function callTgWithToken<T = any>(token: string, method: string, body: Record<string, unknown> = {}): Promise<T> {
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

// Pure rotation flow extracted from the createServerFn handler so tests can
// drive it with mocked fetch + injected persistence. The handler below wires
// production deps (supabaseAdmin, runtime-settings) into this helper.
export type RotationDeps = {
  newToken: string;
  oldToken: string | null;
  webhookBase: string;
  webhookSecret: string;
  persistNewToken: (token: string) => Promise<void>;
};
export type RotationResult = {
  ok: true;
  previousBot: { id: number; username?: string } | null;
  newBot: { id: number; username?: string };
  oldWebhookCleared: boolean | string;
  webhook: { ok: true; url: string } | { ok: false; error: string };
};
export async function executeTokenRotation(deps: RotationDeps): Promise<RotationResult> {
  const { newToken, oldToken, webhookBase, webhookSecret, persistNewToken } = deps;
  const newMe = await callTgWithToken<{ id: number; username?: string }>(newToken, "getMe");
  let oldMe: { id: number; username?: string } | null = null;
  if (oldToken && oldToken !== newToken) {
    try { oldMe = await callTgWithToken(oldToken, "getMe"); } catch { /* may already be revoked */ }
  }
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
  await persistNewToken(newToken);
  let webhook: RotationResult["webhook"];
  if (!webhookBase) webhook = { ok: false, error: "PUBLIC_BASE_URL is not configured — set it then click Register webhook." };
  else if (!webhookSecret) webhook = { ok: false, error: "TELEGRAM_WEBHOOK_SECRET is not configured." };
  else {
    const url = `${webhookBase.replace(/\/$/, "")}/api/public/telegram/webhook`;
    try {
      await callTgWithToken(newToken, "setWebhook", {
        url,
        secret_token: webhookSecret,
        allowed_updates: ["message", "edited_message", "channel_post", "edited_channel_post"],
      });
      webhook = { ok: true, url };
    } catch (e: any) {
      webhook = { ok: false, error: e?.message ?? String(e) };
    }
  }
  return {
    ok: true,
    previousBot: oldMe ? { id: oldMe.id, username: oldMe.username } : null,
    newBot: { id: newMe.id, username: newMe.username },
    oldWebhookCleared,
    webhook,
  };
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
    const { getSetting, bumpSettingsVersion } = await import("@/lib/runtime-settings.server");

    const newToken = data.newToken;
    const oldToken = (await getSetting("TELEGRAM_BOT_TOKEN")) ?? process.env.TELEGRAM_BOT_TOKEN ?? null;
    const webhookBase = (await getSetting("PUBLIC_BASE_URL")) ?? process.env.PUBLIC_BASE_URL ?? "";
    const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";

    const result = await executeTokenRotation({
      newToken,
      oldToken,
      webhookBase,
      webhookSecret,
      persistNewToken: async (tok) => {
        const { error: upErr } = await supabaseAdmin
          .from("app_settings")
          .upsert(
            {
              key: "TELEGRAM_BOT_TOKEN",
              value: tok,
              is_secret: true,
              updated_by: context.userId,
              updated_at: new Date().toISOString(),
            } as never,
            { onConflict: "key" },
          );
        if (upErr) throw upErr;
        bumpSettingsVersion();
      },
    });

    try {
      await supabaseAdmin.from("admin_audit_log").insert({
        actor_user_id: context.userId,
        actor_email: (context.claims as any)?.email ?? null,
        action: "telegram.bot_token.rotate",
        status: result.webhook.ok ? "success" : "partial",
        metadata: {
          old_bot: result.previousBot,
          new_bot: result.newBot,
          old_webhook_cleared: result.oldWebhookCleared,
          webhook: result.webhook,
        },
      } as never);
    } catch (e) {
      console.warn("[rotate] audit insert failed", (e as Error).message);
    }

    return result;
  });
