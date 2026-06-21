// PM2 process file for self-hosted Node SSR deployment (VPS / aaPanel).
//
// Usage on the VPS:
//   cp .env.example .env && nano .env       # fill in real values
//   npm ci
//   npm run build
//   mkdir -p logs
//   pm2 start ecosystem.config.cjs
//   pm2 save
//   pm2 startup                              # follow the printed instruction
//
// aaPanel "Add Node project" → PM2 Project tab:
//   Startup File:  scripts/start.mjs
//   Run Directory: /www/wwwroot/<your-folder>
//   Node Version:  v20.x or newer
//   Package Manager: npm  (or pnpm — pick one and stick with it)
//   Cluster: 1   Memory Limit: 1024   Auto Restart: ON
//
// Logs:
//   logs/out.log       - stdout  (one JSON record per line)
//   logs/err.log       - stderr  (errors + fatal preflight failures)
//   logs/combined.log  - merged
// Rotate with:  pm2 install pm2-logrotate

module.exports = {
  apps: [
    {
      name: "channel-flix",

      // scripts/start.mjs loads .env, runs preflight, then imports the
      // Nitro-built server (dist/server/index.mjs). Do NOT point PM2
      // directly at dist/server/index.mjs — it will not see your .env.
      script: "scripts/start.mjs",
      node_args: [],
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
      time: false,                  // app emits its own ISO timestamps

      // Baseline env. Anything in .env wins because start.mjs loads it after
      // PM2 has already set these (dotenv is called with override:false, but
      // PORT/HOST/NODE_ENV are only defaulted if unset).
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        HOST: "127.0.0.1",
      },
    },
  ],
};
