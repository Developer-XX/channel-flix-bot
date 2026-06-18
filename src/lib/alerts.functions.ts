// Admin alerts: shortener failure-rate monitor + admin notification feed.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminAccess } from "@/lib/admin-auth";

const PROVIDERS = ["adrinolinks","nanolinks","arolinks","linkpays"] as const;
type Provider = typeof PROVIDERS[number];

async function sendTelegram(text: string): Promise<{ sent: boolean; reason?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { sent: false, reason: "no_token" };
  let chatId: string | null = null;
  try {
    const { getSetting } = await import("@/lib/runtime-settings.server");
    chatId = await getSetting("ALERT_TELEGRAM_CHAT_ID");
  } catch { /* ignore */ }
  if (!chatId) return { sent: false, reason: "no_chat_id" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    return { sent: res.ok, reason: res.ok ? undefined : `http_${res.status}` };
  } catch (e: any) {
    return { sent: false, reason: e?.message ?? "fetch_failed" };
  }
}

export const runShortenerAlertCheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getSettingNumber, getSetting } = await import("@/lib/runtime-settings.server");

    const threshold = await getSettingNumber("SHORTENER_ALERT_THRESHOLD", 0.4);
    const minSamples = Math.max(1, Math.round(await getSettingNumber("SHORTENER_ALERT_MIN_SAMPLES", 5)));
    const windowMin = Math.max(5, Math.round(await getSettingNumber("SHORTENER_ALERT_WINDOW_MIN", 30)));
    const sinceIso = new Date(Date.now() - windowMin * 60_000).toISOString();

    const created: Array<{ provider: Provider; rate: number; samples: number; failed: number }> = [];
    for (const p of PROVIDERS) {
      const enabledRaw = await getSetting(`SHORTENER_ENABLED_${p.toUpperCase()}`);
      const enabled = enabledRaw == null
        ? (p === "adrinolinks" || p === "nanolinks")
        : /^(1|true|yes|on)$/i.test(enabledRaw.trim());
      if (!enabled) continue;
      const { data } = await supabaseAdmin.from("shortener_health_log")
        .select("ok").eq("provider", p).gte("checked_at", sinceIso);
      const rows = (data ?? []) as Array<{ ok: boolean }>;
      if (rows.length < minSamples) continue;
      const failed = rows.filter((r) => !r.ok).length;
      const rate = failed / rows.length;
      if (rate >= threshold) {
        const bucket = Math.floor(Date.now() / (windowMin * 60_000));
        const dedupe = `shortener.failrate.${p}.${bucket}`;
        const title = `Shortener ${p} failing (${Math.round(rate*100)}%)`;
        const body = `${failed}/${rows.length} requests failed in the last ${windowMin}min window. Rotation will skip this provider while it is unhealthy.`;
        const { error } = await supabaseAdmin.from("admin_notifications").insert({
          kind: "shortener_failure_rate",
          severity: rate >= 0.75 ? "error" : "warn",
          title, body,
          metadata: { provider: p, failed, samples: rows.length, rate, windowMin, threshold },
          dedupe_key: dedupe,
        } as never);
        // Telegram (best-effort) only on fresh inserts
        if (!error) {
          await sendTelegram(`<b>${title}</b>\n${body}`);
          created.push({ provider: p, rate, samples: rows.length, failed });
        }
      }
    }
    return { ok: true, created, checkedAt: new Date().toISOString() };
  });

export const listAdminNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    includeAcked: z.boolean().optional(),
    limit: z.number().int().min(1).max(200).optional(),
  }).parse(d ?? {}))
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin.from("admin_notifications")
      .select("id, kind, severity, title, body, metadata, acknowledged_at, created_at")
      .order("created_at", { ascending: false }).limit(data.limit ?? 100);
    if (!data.includeAcked) q = q.is("acknowledged_at", null);
    const { data: rows, error } = await q;
    if (error) throw error;
    return rows ?? [];
  });

export const acknowledgeNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("admin_notifications").update({
      acknowledged_at: new Date().toISOString(),
      acknowledged_by: context.userId,
    } as never).eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });
