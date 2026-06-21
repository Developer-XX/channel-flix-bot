// PM2 process file for self-hosted Node SSR deployment.
// Usage:
//   mkdir -p logs
//   pm2 start ecosystem.config.cjs
//   pm2 save && pm2 startup
//
// Logs:
//   logs/out.log    - stdout (structured JSON, one record per line)
//   logs/err.log    - stderr (errors + fatal preflight failures)
//   logs/combined.log - merged stream
//
// Rotate them with `pm2 install pm2-logrotate` (recommended on a VPS).
module.exports = {
  apps: [
    {
      name: "channel-flix",
      // Run preflight first; if env is missing, the wrapper exits non-zero
      // and PM2 marks the app as errored instead of looping a broken server.
      script: "dist/server/index.mjs",
      node_args: [],
      pre_start: "node scripts/preflight.mjs",
      cwd: __dirname,
      instances: 1,                 // bump to "max" for cluster mode
      exec_mode: "fork",            // nitro node-server is a plain http listener
      autorestart: true,
      max_restarts: 10,
      min_uptime: "30s",
      max_memory_restart: "512M",
      kill_timeout: 10_000,         // give in-flight Telegram tasks 10s to finish
      wait_ready: false,

      // ---- Structured logging ----
      out_file: "./logs/out.log",
      error_file: "./logs/err.log",
      combine_logs: true,
      merge_logs: true,
      // App emits JSON lines with its own ISO timestamp; tell PM2 NOT to prepend
      // a second timestamp that would break JSON parsers downstream.
      time: false,

      env: {
        NODE_ENV: "production",
        PORT: 3000,
        HOST: "127.0.0.1",
        // Set ALLOW_DB_ONLY_SECRETS=1 if TMDB_API_KEY / TELEGRAM_BOT_TOKEN
        // live in the app_settings table instead of env.
        // ALLOW_DB_ONLY_SECRETS: "1",
      },
    },
  ],
};
