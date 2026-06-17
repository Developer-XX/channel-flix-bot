# Admin & Shortener Enhancements Plan

## 1. Dedicated shortener redirect endpoint
**New route:** `src/routes/api/public/s/$token.ts`
- Resolves a verification token → target URL.
- Returns **JSON** (not Chrome-redirect HTML) when called with `?debug=1` or `Accept: application/json`:
  ```json
  { "ok": false, "reason": "token_expired", "missing_field": "source_url", "target_url": null }
  ```
- Otherwise issues a proper `302` to the resolved URL.
- Reason codes: `token_missing`, `token_invalid`, `token_expired`, `token_consumed`, `source_missing`, `shortener_failed`, `ok`.
- Logs every call to `admin_audit_log` with `event_type='shortener.redirect'`.

## 2. AdrinoLinks diagnostics panel
**Edit:** `src/routes/_authenticated/admin.diagnostics.tsx`, `src/lib/integrations-health.functions.ts`
- New `shortener_health_log` table (migration): `provider`, `checked_at`, `ok`, `latency_ms`, `error`, `http_status`.
- `getShortenerHealth()` server fn aggregates last 50 checks → returns `{ status, lastCheckedAt, lastError, successRate, avgLatencyMs }`.
- UI card on `/admin/diagnostics`: status badge, last check time, last error, success rate %, "Run check now" button.

## 3. Trash countdown timer
**Edit:** `src/routes/_authenticated/admin.telegram.tsx`
- In Trash tab, add `Expires in` column rendering `formatDistanceToNow(deleted_at + 24h)` with a 1s `useEffect` interval.
- Red badge when < 1 h remaining. "Restore" button stays as-is.

## 4. Idempotent resync
**Edit:** `src/lib/telegram.functions.ts`, `src/lib/telegram-backfill.server.ts`
- Add `idempotency_key TEXT UNIQUE` to `telegram_ingest` (migration) — value = `sha256(channel_id|telegram_message_id|file_unique_id)`.
- `resyncChannels` and ingest pipeline use `upsert(..., { onConflict: 'idempotency_key', ignoreDuplicates: false })` so partial failures + reruns never duplicate rows; existing rows get metadata patched in place.
- Backfill writes a per-run `run_id` to `telegram_bot_state` to track partial progress.

## 5. Admin-editable runtime settings
**New table** (migration): `app_settings (key TEXT PRIMARY KEY, value TEXT, is_secret BOOL, updated_at, updated_by)`, admin-only RLS.
**New page:** `src/routes/_authenticated/admin.settings.tsx`
Editable keys, grouped:
- **Domain:** `PUBLIC_BASE_URL`
- **TMDB:** `TMDB_API_KEY` (masked)
- **Shorteners:** `ADRINOLINKS_API_KEY`, `NANOLINKS_API_KEY` (masked)
- **Verification timing:** `VERIFICATION_WINDOW_MINUTES`, `VERIFICATION_MAX_PER_HOUR`, `SHORTENER_TOKEN_TTL_SECONDS` (new)

**Read priority:** `app_settings` row → `process.env` fallback. Implemented via `src/lib/runtime-settings.server.ts` with 60s in-memory cache + `bumpSettingsVersion()` on save to invalidate.

**Security:** secret values never sent to client — `getSettings()` returns `{ key, isSecret, hasValue, value: isSecret ? null : value }`. Write goes through `updateSetting()` (admin-only, audited).

## Technical notes
- All admin mutations log to `admin_audit_log`.
- Migration order: `app_settings` → `shortener_health_log` → `telegram_ingest.idempotency_key` (backfill from existing rows in same migration).
- No edits to auto-generated Supabase files. No changes to `.env` (settings live in DB).

## Files
**New:** migration, `src/routes/api/public/s/$token.ts`, `src/lib/runtime-settings.server.ts`, `src/lib/runtime-settings.functions.ts`, `src/routes/_authenticated/admin.settings.tsx`
**Edited:** `admin.diagnostics.tsx`, `admin.telegram.tsx`, `integrations-health.functions.ts`, `telegram.functions.ts`, `telegram-backfill.server.ts`, `site-url.server.ts` (read PUBLIC_BASE_URL from settings)
