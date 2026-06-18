# Phase 3 — Reliability, Visibility & Self-Serve

Five features grouped into one phase. Each lands as a small vertical slice (migration → server fn → UI) so we can ship and verify incrementally.

## 1. User download history page (`/account/downloads`)

New authenticated route. Lists the signed-in user's downloads from `download_logs` joined with `media_files` / `master_titles`.

For each row:
- Title + episode label, requested time
- Resend count (sum of `delivery_attempts` for that user+file)
- Cooldown status: `Ready` / `Wait Ns` using the same `DOWNLOAD_RESEND_COOLDOWN_SECONDS` logic the button uses
- Last delivery outcome (sent / reused / failed) + Telegram message link when present
- "Resend to Telegram" inline button (reuses `requestDownload`, honors cooldown countdown)

Server fn: `getMyDownloadHistory({ limit, cursor })` with `requireSupabaseAuth`, RLS-scoped.

Adds a link in the user account menu.

## 2. Admin audit log (unified feed)

Reuses existing `admin_audit_log` table. New event types written from existing code paths:
- `channel_sync.upsert` / `channel_sync.delete` / `channel_sync.backfill_started` / `channel_sync.backfill_completed`
- `token_verification.success` / `token_verification.failure` (from verification flow)
- `cron.auto_delete.run` (count, failures) / `cron.resend.run`
- `download.resend_manual` (admin-initiated resends)

New route `/admin/audit` with:
- Filterable list (event type, actor, date range, search by target)
- Pagination, JSON detail drawer
- Server fn `getAdminAuditLog(filters)` with admin-role check

Existing places that should log (small inserts inside their handlers, no behavior change):
- `src/lib/telegram-api.server.ts` channel CRUD
- `src/routes/api/public/telegram/backfill-ingest.ts`
- Verification provider call site
- `process-message-deletes` cron route
- `requestDownload` resend branch (cooldown reuse and fresh sends)

## 3. Idempotent queued retry for downloads

Goal: a flurry of clicks never produces duplicate Telegram sends, and transient Telegram failures eventually succeed without user re-clicking.

New table `download_send_queue`:
- `idempotency_key` (PK) — same scheme as today: `sha256(user|file|cooldown_window)`
- `user_id`, `file_id`, `chat_id`, `payload jsonb`
- `status` enum: `queued | sending | sent | failed | deduped`
- `attempts int`, `last_error text`, `next_attempt_at timestamptz`
- `message_id bigint` (on success), timestamps

Flow:
1. `requestDownload` upserts into the queue with `ON CONFLICT (idempotency_key) DO NOTHING`. If an existing row is `sent`, return its `message_id` with `reused:true` (current cooldown UX preserved). If `queued/sending`, return `queued:true` with ETA.
2. Inline attempt #1 happens immediately (current code path), result written to queue row.
3. On Telegram failure that's retryable (5xx, network, 429 after `retry_after`), mark `queued` with backoff `next_attempt_at = now() + min(60s * 2^attempts, 15min)`.
4. New pg_cron job `process-download-send-queue` every minute calls `/api/public/hooks/process-download-queue`, which locks due rows with `FOR UPDATE SKIP LOCKED`, sends, updates status. Cap 5 attempts → `failed` + admin alert.

The existing `delivery_attempts` table keeps its per-attempt log; the queue is the durable intent + dedupe key.

## 4. Shortener performance report + rotation controls

Uses existing `shortener_health_log` plus new `shortener_configs` table:
- `provider` (PK: `adrinolinks`, `nanolinks`, …)
- `enabled bool`, `priority int`, `weight int`, `notes text`
- `updated_by`, timestamps

New admin route `/admin/shorteners`:
- Per-provider cards: success rate (7d / 30d), avg time-to-verify (ms), total attempts, last failure
- Toggle enable, set priority (drag or number input), edit weight
- "Test" button → sends a one-off probe link, records result

`src/lib/shortener-rotation.ts` reads from `shortener_configs` (falling back to current hardcoded order) so admin changes take effect without a deploy.

Server fns: `getShortenerReport()`, `updateShortenerConfig(provider, patch)`, `probeShortener(provider)`.

## 5. Cron failure alerts (UI banner + Telegram DM)

Builds on `cron-metrics.functions.ts` / `getAdminHealth`.

New table `admin_alerts`:
- `kind` (`cron_lag`, `cron_failure`, `download_queue_stuck`, `shortener_down`)
- `severity` (`warn|error`), `subject`, `details jsonb`
- `first_seen_at`, `last_seen_at`, `acknowledged_at`, `acknowledged_by`

Generation: each cron handler, at the end of its run, calls `recordCronRun(job_name, ok, summary)` which:
- Writes to `admin_audit_log` (item 2)
- Updates a `cron_job_status` row (last_run_at, last_ok_at, last_error, consecutive_failures)
- Opens an `admin_alerts` row when consecutive failures ≥ 2 OR the job hasn't run in 2× its expected interval (configurable per job)

Surfaces:
- Persistent banner in admin shell when any unacknowledged `error`-severity alert exists; click → `/admin/health` (now also lists per-job last-run + last-error + due lag)
- New `/admin/alerts` page with ack / dismiss
- Telegram DM to all users in `user_roles` with role `admin` who have a linked `telegram_user_links` row, on the transition `consecutive_failures: 1 → 2` (no spam loop; throttled to 1 message / kind / hour). DM uses the existing bot token.

## Technical notes

- All migrations follow the GRANT-then-RLS pattern; user-facing tables (`download_send_queue`, `admin_alerts` reads) use `auth.uid()` policies; admin-only tables use `has_role(auth.uid(), 'admin')`.
- New server fns under `src/lib/*.functions.ts`; cron handlers under `src/routes/api/public/hooks/`.
- pg_cron jobs added once (download queue every 1 min). Existing auto-delete cron just gains the `recordCronRun` call.
- No changes to public published UX besides the user-facing download history link.

## Build order

1. Migration: `download_send_queue`, `shortener_configs`, `cron_job_status`, `admin_alerts` (single migration).
2. Item 3 (queue) — highest reliability win, unblocks item 5 alerts on the queue.
3. Item 2 (audit log) — instrumentation hooks used by items 3 & 5.
4. Item 5 (alerts + Telegram DM).
5. Item 1 (user download history).
6. Item 4 (shortener report + rotation).

I'll ship in that order and check in after items 1-3 land so you can sanity-check before the rest.
