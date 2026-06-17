# Plan: Admin Telegram & Titles enhancements

Five related changes across the admin panel, Telegram pipeline, and titles management.

## 1. Admin audit logging for downloads & deletes
- Reuse existing `admin_audit_log` table.
- Log download failures from `requestDownload` (`src/lib/downloads.functions.ts`): action `download.failed` with `{ file_id, missing_fields, user_id, ip, ua }`. Use a service-role insert so non-admin user failures are still captured.
- Log Telegram deletes from `src/lib/telegram.functions.ts`:
  - `telegram.delete_selected` with `{ ids, count, admin_user_id }`
  - `telegram.delete_all` with `{ count_before, confirmation }`
- Surface a "Recent admin actions" panel on `admin.diagnostics.tsx` filtered to telegram/download actions.

## 2. Admin resync/reingest for selected channels
- New server fn `resyncChannels({ channelIds })` in `src/lib/telegram.functions.ts` (admin-only).
  - For each channel: call existing backfill helper in `telegram-backfill.server.ts` to re-scan recent posts.
  - Re-populate missing metadata fields on existing `telegram_ingest` rows (e.g., `quality`, `language`, `season`, `episode`, `parsed_title`) using the parser in `telegram-parser.ts`. Update only NULL/empty fields — never overwrite admin-curated data; uniqueness keyed on `(channel_id, telegram_message_id)` prevents duplicate rows.
  - Return `{ scanned, updated, inserted }` counts.
- UI: add "Resync selected channels" button on `admin.telegram.tsx` channels list.

## 3. Search & filters for the admin Telegram files table
- Extend `listIngest` server fn with filters: `q` (name search), `channelId`, `quality`, `language`, `season`, `episode`, `dateFrom`, `dateTo`.
- Update `admin.telegram.tsx`:
  - Filter bar above the table (Input + Selects + date range).
  - Debounced query refresh and pagination reset on filter change.
  - Reset button to clear all filters.

## 4. Soft-delete / undo window for ingested files (24h)
- Migration: add `deleted_at timestamptz` + `deleted_by uuid` + `deleted_reason text` to `telegram_ingest`; partial index `WHERE deleted_at IS NULL`. Same columns on `media_files`.
- Change `deleteIngestRows` and `deleteAllIngest` to UPDATE `deleted_at = now()` instead of physical delete. Cascade to `media_files` (soft).
- Default list query excludes soft-deleted rows. Add "Trash" tab in `admin.telegram.tsx` to view items deleted in the last 24h with **Restore** button.
- New server fns: `restoreIngestRows(ids)`, `purgeExpiredSoftDeletes()` (hard-delete rows older than 24h). The purge runs lazily on each admin list call (cheap WHERE-clause delete) — no cron needed.

## 5. Edit title details + verification
- New server fn `updateTitle({ id, fields })` in `src/lib/admin.functions.ts` (admin-only). Allowed fields: `title`, `original_title`, `overview`, `release_date`, `poster_path`, `backdrop_path`, `runtime`, `genres`, `language`, `slug`, `kind`.
- Auto-regenerate slug on title change (collision check via existing slug helper).
- Edit UI: add an "Edit" button on each row in `admin.titles.tsx` opening a Dialog with a form (react-hook-form + zod). On save: invalidate queries, toast.
- Verification pass after edit:
  - Validate slug uniqueness server-side.
  - Update related `idx_search` row in same transaction so search reflects the change.
  - Log to `admin_audit_log` (`title.updated` with before/after diff).

## Technical notes

- All new server fns use `requireSupabaseAuth` + `has_role(admin)` check; failures throw 403.
- Audit-log inserts use `supabaseAdmin` (loaded inside handler) so RLS doesn't drop entries.
- Migration order: add soft-delete columns → backfill `deleted_at = NULL` (default) → swap delete fns. No data loss.
- Existing `pending_destructive_actions` confirmation flow for `delete_all` is preserved; only the executor switches to soft-delete.

## Files

**Created**
- `supabase/migrations/<ts>_soft_delete_and_audit.sql`

**Updated**
- `src/lib/downloads.functions.ts` — log failures
- `src/lib/telegram.functions.ts` — soft-delete, resync, filters, audit
- `src/lib/admin.functions.ts` — `updateTitle`
- `src/routes/_authenticated/admin.telegram.tsx` — filters, trash tab, resync button
- `src/routes/_authenticated/admin.titles.tsx` — edit dialog
- `src/routes/_authenticated/admin.diagnostics.tsx` — recent admin actions panel

Proceed?
