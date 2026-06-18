// Cron endpoint: scan recent shortener health and emit admin alerts when
// failure rate exceeds the configured threshold. Idempotent via dedupe_key.
import { createFileRoute } from "@tanstack/react-router";

const PROVIDERS = ["adrinolinks","nanolinks","arolinks","linkpays"] as const;

export const Route = createFileRoute("/api/public/hooks/shortener-alerts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { checkCronAuth } = await import("@/lib/cron-auth.server");
        const auth = checkCronAuth(request);
        if (!auth.ok) return auth.response;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { getSetting, getSettingNumber } = await import("@/lib/runtime-settings.server");

        const threshold   = await getSettingNumber("SHORTENER_ALERT_THRESHOLD", 0.4);
        const minSamples  = Math.max(1, Math.round(await getSettingNumber("SHORTENER_ALERT_MIN_SAMPLES", 5)));
        const windowMin   = Math.max(5, Math.round(await getSettingNumber("SHORTENER_ALERT_WINDOW_MIN", 30)));
        const telegramId  = await getSetting("ALERT_TELEGRAM_CHAT_ID");
        const sinceIso    = new Date(Date.now() - windowMin * 60_000).toISOString();
        const created: any[] = [];

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
            const body = `${failed}/${rows.length} requests failed in the last ${windowMin}min window.`;
            const { error } = await supabaseAdmin.from("admin_notifications").insert({
              kind: "shortener_failure_rate",
              severity: rate >= 0.75 ? "error" : "warn",
              title, body,
              metadata: { provider: p, failed, samples: rows.length, rate, windowMin, threshold },
              dedupe_key: dedupe,
            } as never);
            if (!error) {
              created.push({ provider: p, rate, samples: rows.length, failed });
              const token = process.env.TELEGRAM_BOT_TOKEN;
              if (token && telegramId) {
                try {
                  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ chat_id: telegramId, text: `<b>${title}</b>\n${body}`, parse_mode: "HTML", disable_web_page_preview: true }),
                  });
                } catch { /* best-effort */ }
              }
            }
          }
        }

        return Response.json({ ok: true, created, checkedAt: new Date().toISOString() });
      },
    },
  },
});
