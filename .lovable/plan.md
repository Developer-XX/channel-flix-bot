## Phase 1 scope (Telegram only)

Three deliverables. Ads validation, analytics events, cron widget, and the download timer UI are deferred to Phase 2.

---

### 1. Channel auto-sync — new posts (works today, Bot API)

Goal: admin adds a channel ID in the panel, promotes the bot to channel admin, and from that moment every new post is ingested automatically. No "send file to bot" step.

Changes:
- In `src/routes/api/public/telegram/webhook.ts`, accept `channel_post` and `edited_channel_post` updates (not just DMs to the bot).
- Verify the `chat.id` is in `telegram_channels` and active. If not, ignore.
- Reuse the existing `telegram_ingest` pipeline (parser + matcher) — same idempotency key (`channel_id:message_id`).
- Update the `setWebhook` registration call so `allowed_updates` includes `channel_post` and `edited_channel_post`.
- Admin panel: when a channel is added, show a checklist ("Bot added as admin? ✓ Channel ID verified? ✓") and a "Test ingest" button that asks the bot to confirm it can read the channel via `getChat`.

This covers all **future** posts to the channel automatically.

---

### 2. Channel backfill — existing history (MTProto, out-of-Worker)

Bot API hard limitation: a bot cannot read messages posted before it joined, and cannot page channel history. Only a user account via MTProto can.

Since MTProto cannot run in workerd, the realistic options are:

**Option A — External backfill worker (recommended).** Ship a small Node script (`scripts/telegram-backfill/`) that the admin runs once per channel from their own machine or a one-off container. It:
  1. Uses `gramjs` with the admin's `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` / phone login (interactive first run, stores `STRING_SESSION` for reuse).
  2. Iterates `channel.getHistory` in batches.
  3. POSTs each historical message to a new `/api/public/telegram/backfill-ingest` route (HMAC-signed with a `BACKFILL_SECRET`) which runs it through the same ingest pipeline.
  4. Reports progress + a resumable cursor stored in `telegram_channels.backfill_cursor`.

Admin UI adds: per-channel "Backfill" panel showing cursor, last-run timestamp, count ingested, and copy-pastable command (`bun run backfill --channel <id>`).

**Option B — Manual forward (fallback).** Admin forwards old messages to the bot in batches; existing DM-ingest path handles them. Documented as fallback for small channels.

I'll build A as the primary path and keep B working.

Secrets needed (I'll prompt via `add_secret` when we get there): `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `BACKFILL_SECRET`. Phone/session stays on the admin's machine — never uploaded.

---

### 3. Reliable delivery with cooldown-window idempotency + retries

Current `src/lib/delivery.server.ts` uses a unique key per click. Change to: idempotency key = `sha256(user_id|file_id|floor(now / DOWNLOAD_RESEND_COOLDOWN_SECONDS))`.

Behavior:
- **Within cooldown window**: same key → return the prior `delivery_attempts` row's `message_id` (no re-send). Bot's previous message still exists in the user's chat.
- **After cooldown elapses**: new key → fresh send. New `scheduled_message_deletes` row.
- **Telegram API failures**: retry with exponential backoff (250ms, 1s, 3s) on 5xx and `429` (respecting `retry_after`). 4xx other than 429 → fail fast, log structured error, surface actionable message to user.
- **Partial failure recovery**: if `sendDocument` succeeded but DB write failed, the next click within the cooldown window detects the orphan via a `delivery_attempts` lookup keyed on idempotency key + status = `in_flight` and reconciles.

New columns on `delivery_attempts`: `idempotency_key text unique`, `attempt_count int default 0`, `last_error text`, `status text` (`in_flight` | `delivered` | `failed`).

---

### Files I'll touch / create

Created:
- `src/routes/api/public/telegram/backfill-ingest.ts` (HMAC-verified ingest endpoint)
- `scripts/telegram-backfill/` (Node MTProto script + README)
- `supabase/migrations/<ts>_delivery_idempotency_and_backfill_cursor.sql`

Edited:
- `src/routes/api/public/telegram/webhook.ts` (accept channel_post)
- `src/lib/telegram-ingest.server.ts` (channel_post normalization)
- `src/lib/delivery.server.ts` (cooldown-window keying + retry loop + reconciliation)
- `src/lib/telegram-api.server.ts` (retry helper, parse `retry_after`)
- `src/routes/_authenticated/admin.telegram.tsx` (per-channel backfill panel, test-ingest button)
- `src/lib/telegram.functions.ts` (test-ingest server fn, backfill status query)

### Deferred to Phase 2 (next turn after this lands)
- Ad placement validation + admin error messaging
- Download resend / auto-delete analytics events + dashboard panel
- Cron widget for `process-message-deletes`
- DownloadButton cooldown countdown UI

Approve and I'll start with the migration, then the webhook + delivery changes, then the backfill script + admin UI.