# VPS Deployment Runbook

Production deployment of `channel-flix-bot` on a self-hosted VPS (Node 20 +
PM2 + Nginx). The app is a **TanStack Start** SSR server; data and auth live
in **Lovable Cloud (Supabase)**. There is **no Prisma**, **no Redis**, and
**no separate Express API** — everything runs inside the single Node process.

---

## 1. Required environment variables

Put these in `/www/wwwroot/movies.vybeprints.info/channel-flix-bot/.env`
(chmod 600, owned by the PM2 user). Server reads `.env` then
`.env.production` then `.env.local` (later does NOT override earlier).

### Server-only (process.env)

| Var | Purpose |
| --- | --- |
| `SUPABASE_URL` | Lovable Cloud project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Public API key (server fns using auth middleware) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role — bypasses RLS, never expose to browser |
| `TELEGRAM_BOT_TOKEN` | Bot used for downloads and ops alerts |
| `TELEGRAM_WEBHOOK_SECRET` | Validates inbound Telegram webhook |
| `TMDB_API_KEY` | Metadata enrichment |
| `CRON_SECRET` | Shared secret for cron-hit public hook routes |
| `BACKFILL_SECRET` | Shared secret for backfill scripts |
| `OPS_ALERT_CHAT_ID` | Telegram chat ID receiving production alerts (NEW) |
| `OPS_ALERT_MIN_LEVEL` | `info` \| `warn` \| `error` (default `warn`) |
| `RATE_LIMIT_PER_MIN` | Per-IP rate limit on POST endpoints (default 60) |
| `PORT` | Default 3000 |
| `HOST` | Default 127.0.0.1 (behind Nginx) |
| `NODE_ENV` | `production` |

### Build-time (baked into the client bundle by Vite)

These must be set **before `npm run build`**. Changing them requires a rebuild.

| Var | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Same value as `SUPABASE_URL` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Same value as `SUPABASE_PUBLISHABLE_KEY` |
| `VITE_SUPABASE_PROJECT_ID` | Project ref (no protocol) |

---

## 2. First-time setup

```bash
# 0. Prerequisites
node -v        # must be >= 20
npm -v
pm2 -v || npm i -g pm2

# 1. Clone
cd /www/wwwroot/movies.vybeprints.info
git clone https://github.com/<you>/channel-flix-bot.git
cd channel-flix-bot

# 2. Install
npm ci --no-audit --no-fund

# 3. Configure
cp .env.example .env   # or create from the table above
chmod 600 .env

# 4. Build (uses VITE_* from .env)
npm run build

# 5. First start
pm2 start npm --name channel-flix -- run start
pm2 save
pm2 startup    # follow the printed command to enable boot-time start
```

---

## 3. Routine deploy (every release)

```bash
cd /www/wwwroot/movies.vybeprints.info/channel-flix-bot

git pull --ff-only
npm ci --no-audit --no-fund
npm run build
pm2 restart channel-flix --update-env
pm2 logs channel-flix --lines 100 --nostream
node scripts/smoke-test.mjs               # exits non-zero on failure
```

`scripts/start.mjs` automatically runs `scripts/preflight.mjs`, which exits
non-zero (and PM2 marks the process `errored`) if a required env var is
missing. A Telegram alert is sent to `OPS_ALERT_CHAT_ID` on boot failure,
backup-export failure, and verification-token failure.

---

## 4. Database / migrations (Lovable Cloud Supabase)

Schema changes happen through the Lovable migration tool in the editor — they
do **not** require running anything on the VPS. After a migration is approved
and applied:

1. Pull latest code (`git pull`) — the regenerated
   `src/integrations/supabase/types.ts` ships with it.
2. Rebuild and restart (see Routine deploy).

Manual SQL on the VPS is not supported — there is no direct `psql` access.

### Local sanity check before push

```bash
# Validate that every public-schema CREATE TABLE in supabase/migrations/
# is followed by a GRANT statement (the CI workflow runs the same check).
ls supabase/migrations/
```

---

## 5. Health & service checks

```bash
# App
curl -fsS http://127.0.0.1:3000/api/public/health | jq

# PM2
pm2 status
pm2 logs channel-flix --lines 200

# Nginx
nginx -t && systemctl status nginx

# Full smoke
BASE_URL=https://movies.vybeprints.info \
  PREMIUM_DOWNLOAD_PATH=/title/<a-known-slug> \
  node scripts/smoke-test.mjs
```

There is **no Redis** in this stack. Rate-limit counters live in the
`public.rate_limit_buckets` table on Lovable Cloud and are cleaned up
automatically by the `rl_hit` RPC.

---

## 6. Monitoring & alerts

- **Logs**: PM2 captures JSON-per-line stdout/stderr at
  `~/.pm2/logs/channel-flix-*.log`. Ship to Loki/Datadog by tailing those.
- **Alerts**: `src/lib/ops-alert.server.ts` sends Telegram messages for
  `error`-level events. Failure surfaces wired today:
  - Server boot / preflight failure (`scripts/start.mjs`)
  - `exportAllData` backup failure
  - Verification token failures
- **Tracing**: Every request gets an `x-request-id` (honors inbound header
  from Nginx) and is logged with method, path, status, duration, ip, ua.
- **Per-table grant drift**: `public.check_telegram_ingest_grants()` writes
  to `admin_alerts` automatically.

---

## 7. Security posture

- HTTPS terminates at Nginx → upstream `127.0.0.1:3000`.
- HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy,
  Permissions-Policy, and a Report-Only CSP are emitted on every response
  by `src/lib/security-middleware.ts`.
- Rate limit: per-IP, 60 req/min on `/_serverFn/*`, `/api/public/hooks/*`,
  `/api/public/telegram/*`. Override with `RATE_LIMIT_PER_MIN`.
- Nginx should forward the real client IP:
  ```nginx
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Real-IP $remote_addr;
  ```

---

## 8. Rollback

```bash
cd /www/wwwroot/movies.vybeprints.info/channel-flix-bot

# A) Roll back to the previous commit
git fetch --all
git log --oneline -n 10
git checkout <previous-sha>
npm ci --no-audit --no-fund
npm run build
pm2 restart channel-flix --update-env
node scripts/smoke-test.mjs

# B) Database rollback
#    Schema changes are managed through the Lovable migration tool. To roll
#    one back, open the editor and request the inverse migration — there is
#    no per-migration `down` script in this repo. Restore application data
#    from the most recent admin backup export (Admin → Backup).
```

If smoke fails after rollback, restore the entire project directory from the
nightly tarball (`/backups/channel-flix-bot-YYYYMMDD.tar.gz`) and run
`npm ci && npm run build && pm2 restart channel-flix`.
