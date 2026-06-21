#!/usr/bin/env node
// Startup validation — refuses to boot the server if required runtime env vars
// are missing. PM2 will mark the process as errored instead of silently
// serving 500s. Run automatically via `npm start`.
//
// Note: TMDB_API_KEY / TELEGRAM_BOT_TOKEN can also live in the admin-editable
// `app_settings` table, but at cold-start we have no DB yet — so we require
// them as env vars for the PM2-managed deployment. If you prefer DB-only
// configuration, set ALLOW_DB_ONLY_SECRETS=1 to downgrade these to warnings.

const REQUIRED = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
];

const REQUIRED_OR_DB = ["TMDB_API_KEY", "TELEGRAM_BOT_TOKEN"];

const missing = REQUIRED.filter((k) => !process.env[k]);
const missingOrDb = REQUIRED_OR_DB.filter((k) => !process.env[k]);

async function alertOps(level, message, details) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.OPS_ALERT_CHAT_ID;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: `🔥 ${level.toUpperCase()} · startup\nhost: ${process.env.HOSTNAME || "vps"}\ntime: ${new Date().toISOString()}\n\n${message}\n\n${JSON.stringify(details ?? {}, null, 2)}`.slice(0, 3900),
      }),
    });
  } catch {
    /* never block boot on alert failure */
  }
}

if (missing.length) {
  console.error(
    JSON.stringify({
      level: "fatal",
      msg: "preflight failed: missing required env vars",
      missing,
      ts: new Date().toISOString(),
    }),
  );
  await alertOps("error", "preflight failed: missing required env vars", { missing });
  process.exit(1);
}

if (missingOrDb.length) {
  const allow = process.env.ALLOW_DB_ONLY_SECRETS === "1";
  console.error(
    JSON.stringify({
      level: allow ? "warn" : "fatal",
      msg: allow
        ? "preflight: secrets not in env, expecting them in app_settings table"
        : "preflight failed: set these in env, or pass ALLOW_DB_ONLY_SECRETS=1 to rely on app_settings",
      missing: missingOrDb,
      ts: new Date().toISOString(),
    }),
  );
  if (!allow) process.exit(1);
}

console.log(
  JSON.stringify({
    level: "info",
    msg: "preflight ok",
    node: process.version,
    ts: new Date().toISOString(),
  }),
);
