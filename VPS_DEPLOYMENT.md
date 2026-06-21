# Self-Hosting on a VPS (aaPanel + PM2 + Nginx)

This project is a TanStack Start app that builds to a Node SSR server
(`dist/server/index.mjs`). It runs anywhere Node 20+ runs — including a VPS
managed by aaPanel.

The single most common cause of a "white screen / login broken on the VPS but
fine on Lovable" is **missing environment variables**. `.env` is git-ignored
on purpose (secrets), so you must create it on the server before building.

---

## 1. Prepare the server (aaPanel)

1. Install **Node 20.x or newer** via aaPanel → Website → Node.js Project →
   *Node version manager*.
2. Install **PM2** (aaPanel installs it for you the first time you create a
   PM2 project).
3. Install **Nginx** (already included in aaPanel).

## 2. Upload the code

Either `git clone` the repo into `/www/wwwroot/channel-flix` or use aaPanel's
*Pull Git project* button.

```bash
cd /www/wwwroot/channel-flix
npm ci
```

## 3. Create `.env` (CRITICAL — do this BEFORE building)

```bash
cp .env.example .env
nano .env
```

Fill in every value. Pay attention to the two groups:

| Group        | Prefix       | When read                              |
|--------------|--------------|----------------------------------------|
| Client       | `VITE_*`     | **At build time** (baked into JS)      |
| Server-only  | no prefix    | At runtime (loaded by `scripts/start.mjs`) |

If you later change a `VITE_*` value you MUST re-run `npm run build`.

The service role key, TMDB key, and Telegram token are server-only — never
prefix them with `VITE_`.

## 4. Build

```bash
npm run build
```

Output goes to `dist/`. Smoke-test it once without PM2:

```bash
npm start
# in another shell:
curl -s http://127.0.0.1:3000/health | head
```

You should see a JSON health response. Stop with `Ctrl+C`.

## 5. Start under PM2

### Option A — from the command line

```bash
mkdir -p logs
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup        # run the command it prints, once
pm2 logs channel-flix
```

### Option B — from aaPanel UI

Open **Website → Node.js Project → Add Project → PM2 Project tab** (the dialog
in your screenshot) and fill in:

| Field            | Value                                |
|------------------|--------------------------------------|
| Project Name     | `channel-flix`                       |
| Node Version     | v20.x (or newer)                     |
| Startup File     | `scripts/start.mjs`                  |
| Run Directory    | `/www/wwwroot/channel-flix`          |
| Cluster          | `1`                                  |
| Memory Limit     | `1024` MB                            |
| Auto Restart     | ON                                   |
| Package Manager  | `npm` (or `pnpm`)                    |

Click **More settings** and make sure the working directory is the project
root (where `.env` lives). Confirm.

> **Do NOT point the Startup File at `dist/server/index.mjs` directly.**
> That file does not load `.env`. `scripts/start.mjs` loads `.env`, runs
> preflight, then boots the server.

## 6. Nginx reverse proxy

In aaPanel → Website → Add Site → create a site for your domain, then edit
its Nginx config and add inside the `server { ... }` block:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Request-Id $request_id;

    # WebSocket / SSE
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";

    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
}

# Long-running Telegram tasks
location /api/public/telegram/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Reload Nginx (aaPanel does this automatically when you save). Then enable
HTTPS via aaPanel's **SSL → Let's Encrypt** tab.

## 7. Verify

```bash
curl -s https://your-domain.example/health | jq
pm2 logs channel-flix --lines 50
```

You should be able to sign in, browse, and use the admin panel.

---

## Troubleshooting

**"Login does not work / Supabase URL undefined in browser"**
You built before creating `.env`. Re-create `.env`, then:
```bash
npm run build && pm2 restart channel-flix
```

**`preflight failed: missing required env vars`**
Open `.env`, make sure every required key is set, save, then
`pm2 restart channel-flix`.

**`TMDB_API_KEY not configured` / `TELEGRAM_BOT_TOKEN not configured`**
Either fill them into `.env` and restart, OR set `ALLOW_DB_ONLY_SECRETS=1` in
`.env` and configure them from the in-app admin panel. They are cached for
~60 seconds after you save in the admin panel.

**Port 3000 already in use**
Change `PORT` in `.env` and update `proxy_pass` in Nginx to match.

**Updating to a new build**
```bash
git pull
npm ci
npm run build
pm2 restart channel-flix
```
