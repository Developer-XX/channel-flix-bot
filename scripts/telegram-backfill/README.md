# Telegram channel backfill (MTProto / user-account)

The Telegram **Bot API cannot read channel history posted before the bot
joined**. To import existing files, we use a small Node script that signs in
as a **user account** via MTProto (gramjs), pages channel history, and posts
each message to the app's `/api/public/telegram/backfill-ingest` endpoint.

This script runs **on your local machine or a one-off container** — not in
the Lovable backend, because MTProto requires raw TCP and a persistent
session that workerd does not support.

## One-time setup

1. Get a Telegram **API ID** and **API hash** from https://my.telegram.org
   → API Development Tools. (These are per-user, not per-bot.)
2. Copy `.env.example` to `.env` and fill in:
   ```
   TELEGRAM_API_ID=...
   TELEGRAM_API_HASH=...
   BACKFILL_SECRET=...           # must match the BACKFILL_SECRET added to Lovable
   APP_URL=https://channel-flix-bot.lovable.app   # your published or dev URL
   STRING_SESSION=               # leave blank on first run; the script prints it
   ```
3. Install deps and run once interactively to log in:
   ```bash
   cd scripts/telegram-backfill
   npm install
   node backfill.mjs --login
   ```
   You will be prompted for your phone number, SMS code, and 2FA password (if
   enabled). On success it prints a `STRING_SESSION=...` value — paste it
   into `.env` so future runs are non-interactive.

## Running a backfill

```bash
node backfill.mjs --channel -1001234567890        # by numeric chat id
node backfill.mjs --channel @your_channel_name    # by @username
node backfill.mjs --channel -100... --limit 500   # cap how many messages to ingest
node backfill.mjs --channel -100... --resume      # resume from saved cursor in DB
```

The script:
- Iterates `messages.getHistory` in batches of 100 (oldest → newest).
- For each message with a file (document, video, audio, photo), POSTs a
  synthetic Bot-API-shaped update to `/api/public/telegram/backfill-ingest`
  with an HMAC-SHA256 signature.
- Periodically POSTs progress (`cursor`, `ingested`, `status`) so the admin
  panel can show "Backfill: 1,237 ingested, last run 2 min ago".

The same caption parser / matcher / auto-promotion pipeline that powers
realtime ingest runs server-side, so backfilled messages land in the catalog
identically to live posts.

## Security

- `BACKFILL_SECRET` must be added as a Lovable secret with the same value
  used in the script's `.env`.
- The script's `STRING_SESSION` never leaves your machine.
- The signed HMAC over the raw body prevents anyone without the secret from
  injecting fake history into the catalog.

## Fallback: manual forward

For very small channels you can skip MTProto entirely: forward old posts to
the bot in DM and they will be ingested via the existing DM-ingest path.
