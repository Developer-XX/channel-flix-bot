// PM2 process file for self-hosted Node SSR deployment.
// Usage:  pm2 start ecosystem.config.cjs --env production
module.exports = {
  apps: [
    {
      name: "channel-flix",
      script: "dist/server/index.mjs",
      cwd: __dirname,
      instances: 1,                 // bump to "max" for cluster mode
      exec_mode: "fork",            // nitro node-server is a plain http listener
      autorestart: true,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        HOST: "127.0.0.1",
      },
    },
  ],
};
