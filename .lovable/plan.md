
## Scope

Six related slices. The verification piece (#6) is the one that needs a decision before I start — everything else I can build immediately with reasonable defaults.

---

### 1. Retries + idempotency for Telegram DM sends

- Add a `delivery_attempts` table:
  - `id`, `user_id`, `media_file_id`, `idempotency_key` (UNIQUE),
    `attempt_no`, `status` (`pending|delivered|failed`), `error`,
    `telegram_message_id`, `created_at`, `updated_at`.
- `requestDownload` generates `idempotency_key = sha256(user_id|media_file_id|hour-bucket)` so duplicate clicks inside the same bucket reuse the existing row instead of double-sending.
- On `tryCopyMessage` failure, retry with exponential backoff (250ms, 1s, 3s) up to 3 attempts. Treat `blocked` / `not_started` / `not_found` as non-retryable.
- Each attempt is upserted into `delivery_attempts` (and mirrored into `download_logs`).

### 2. Download audit log

- Reuse existing `download_logs` and extend it (via migration) with:
  `verification_status`, `verification_provider`, `bot_user_id`,
  `idempotency_key`, `attempt_count`, `attempt_history jsonb`.
- Record every: verification redirect, verification callback, link-code request, DM attempt (success or failure) with timestamps and the Telegram `bot_user_id` resolved from `getMe()` (cached).
- Add an admin tab "Delivery log" listing the last 200 rows with filters by status / user / file.

### 3. DownloadButton validation

- Before the request, `DownloadButton` re-queries `media_files` by `(title_id, season, episode, id)` and confirms the row still resolves to the expected `telegram_file_id`.
- For series, callers pass `season` + `episode`; the button picks the most recent active file matching that tuple. If the file_id changed (re-promoted), it uses the new one.
- If no row matches, surface a friendly "this episode was reorganized — refresh" toast and call `router.invalidate()`.

### 4. Admin bulk job: forceRematchAndPublish over last N days

- New server fn `bulkForceRematch({ days, dryRun? })`:
  loops over `telegram_ingest` where `match_status='unmatched'` and `created_at >= now()-N days`, runs `forceRematchAndPublish` per row, streams progress into a `bulk_job_runs` table:
  `id, job_type, started_at, finished_at, total, processed, promoted, failed, last_error, status`.
- Admin UI: "Bulk rematch unmatched (N days)" with N input, Run/Cancel buttons, and a progress card that polls `getBulkJobStatus` every 2s.

### 5. Background index rebuild scheduler

- New `pg_cron` job (every 10 minutes) → calls `POST /api/public/hooks/maybe-rebuild-indexes`.
- The handler checks a `telegram_bot_state` flag:
  - `pending_index_rebuild=true` (set by `bumpCacheVersion` whenever ≥ N promotions happen since last rebuild)
  - `indexes_rebuilding_at` lock (skip if a rebuild started <5 min ago — prevents overlap).
- Promotion code increments `promotions_since_last_index` and flips `pending_index_rebuild` once threshold (default 25) is crossed.
- Admin sees "Last rebuilt: …, pending: yes/no, in-flight: no" panel.

### 6. 24h token verification via nanolinks ↔ adrinolinks (decision needed)

Per your earlier spec the cycle alternates between `nanolinks.in` and `adrinolinks.in` — you said 12h then, "every 24h" now. I'll assume **24h cycle, alternating provider each cycle** unless you say otherwise.

Flow:
```text
User clicks Download
  → server checks user_verifications.expires_at
      ├─ valid  → proceed to DM send (slice 1)
      └─ expired/missing
            → mint token, pick next provider (nanolinks if last was adrinolinks, else adrinolinks)
            → shorten https://<site>/v/<token> via provider API
            → redirect user to shortened URL
            → provider redirects user back to /v/<token>
            → /v/<token> marks verification valid for 24h, redirects to original download
            → bot DM proceeds
```

Tables:
- `user_verifications`: `user_id` PK, `last_provider`, `verified_at`, `expires_at`, `verification_count`.
- `verification_tokens`: `token` PK, `user_id`, `media_file_id` (return target), `provider`, `created_at`, `consumed_at`, `expires_at`, `ip_hash` (anti-abuse).

Routes:
- `GET /api/public/v/:token` — consume token, write `user_verifications`, redirect to the original media-file download trigger.
- Server fn `startVerification({ mediaFileId })` — mints token, returns shortener URL.

Anti-abuse:
- 1 outstanding unconsumed token per user (older ones invalidated).
- Token TTL 30 min; consumed_at must be null; ip hash recorded.
- Rate limit `startVerification` to 6/hour per user via `auth_rate_limits`.

**Decision I need (one answer):**

I will need API credentials for the shorteners. Options:

- **A. I have both nanolinks + adrinolinks API keys** → I'll add them as secrets and call their real shorten endpoints.
- **B. Only one (which?)** → I'll wire that one as the active provider and stub the other behind a feature flag (no alternating until you add it).
- **C. None yet** → I'll build the full flow but use a "passthrough" stub provider (redirects directly back to `/v/<token>`) so you can test end-to-end. Swap to the real provider by adding the secret later.

---

### Build order

1. Migration: `delivery_attempts`, `bulk_job_runs`, `user_verifications`, `verification_tokens`, extend `download_logs` and `telegram_bot_state`.
2. Slice 1 (retries) + slice 2 (audit) — wired into `requestDownload`.
3. Slice 3 (DownloadButton episode validation).
4. Slice 6 (verification gate) using the answer to the decision above.
5. Slice 4 (bulk rematch) + admin UI.
6. Slice 5 (cron + auto-rebuild) + admin status panel.

Reply with **A / B / C** (and any keys if A or B) and I'll start.
