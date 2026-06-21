/**
 * Lightweight production alerting via the existing Telegram bot.
 *
 * Server-only. Fire-and-forget — never throws, never blocks the caller.
 * Used by:
 *   - scripts/start.mjs / preflight.mjs (boot/startup failures)
 *   - admin-backup.functions.ts         (export failures)
 *   - verification.functions.ts         (token verification failures)
 *
 * Required env:
 *   TELEGRAM_BOT_TOKEN     — the bot used for outbound alerts
 *   OPS_ALERT_CHAT_ID      — chat/channel ID to receive alerts (set this!)
 * Optional env:
 *   OPS_ALERT_MIN_LEVEL    — "info" | "warn" | "error" (default "warn")
 *   OPS_ALERT_DEDUPE_SEC   — suppress identical alerts within N seconds (default 300)
 */

type Level = "info" | "warn" | "error";

const LEVELS: Record<Level, number> = { info: 1, warn: 2, error: 3 };
const RECENT = new Map<string, number>();

function shouldSend(level: Level, key: string) {
  const min = (process.env.OPS_ALERT_MIN_LEVEL as Level | undefined) ?? "warn";
  if (LEVELS[level] < LEVELS[min]) return false;
  const ttlMs = Math.max(0, Number(process.env.OPS_ALERT_DEDUPE_SEC ?? 300)) * 1000;
  if (ttlMs === 0) return true;
  const now = Date.now();
  const last = RECENT.get(key) ?? 0;
  if (now - last < ttlMs) return false;
  RECENT.set(key, now);
  // best-effort GC
  if (RECENT.size > 500) {
    for (const [k, t] of RECENT) if (now - t > ttlMs) RECENT.delete(k);
  }
  return true;
}

export interface AlertInput {
  level: Level;
  source: string;        // e.g. "startup", "backup.export", "verification.verify"
  message: string;       // short, human-readable
  details?: unknown;     // optional structured payload
}

export function notifyOpsAlert(input: AlertInput): void {
  // Never block; never propagate failures.
  queueMicrotask(() => {
    void sendInternal(input).catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[ops-alert] dispatch failed:", err);
    });
  });
}

async function sendInternal({ level, source, message, details }: AlertInput) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.OPS_ALERT_CHAT_ID;
  if (!token || !chatId) {
    // Still log to stderr so PM2 captures it.
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        level,
        msg: "ops_alert (no telegram config)",
        source,
        message,
        details,
        ts: new Date().toISOString(),
      }),
    );
    return;
  }

  const key = `${source}|${message}`;
  if (!shouldSend(level, key)) return;

  const emoji = level === "error" ? "🔥" : level === "warn" ? "⚠️" : "ℹ️";
  const host = process.env.HOSTNAME || process.env.HOST || "unknown-host";
  const detailsStr =
    details === undefined
      ? ""
      : "\n<pre>" +
        escapeHtml(
          typeof details === "string" ? details : safeJson(details).slice(0, 1500),
        ) +
        "</pre>";

  const text =
    `${emoji} <b>${escapeHtml(level.toUpperCase())}</b> · <code>${escapeHtml(source)}</code>\n` +
    `<b>host:</b> ${escapeHtml(host)}\n` +
    `<b>time:</b> ${new Date().toISOString()}\n\n` +
    escapeHtml(message) +
    detailsStr;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text.slice(0, 3900),
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.error("[ops-alert] telegram HTTP", res.status, await res.text());
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[ops-alert] telegram fetch failed:", err);
  }
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
