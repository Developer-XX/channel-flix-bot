## Slice 1 — Bot-DM file delivery (with account linking)

Click "Download" on the website → bot sends the file to the user's Telegram DM.

**Schema (one migration):**
- `telegram_user_links(user_id uuid PK→auth.users, telegram_user_id bigint UNIQUE, telegram_username text, linked_at timestamptz, link_code text UNIQUE, link_code_expires_at timestamptz)` — RLS: user reads/updates own row.
- `download_logs` already exists; add `delivery_status text`, `delivery_error text`, `delivered_at timestamptz`.

**Flow:**
1. User clicks Download on `title.$slug.tsx`. If not signed in → "Sign in to download" CTA. If signed in but no Telegram link → modal showing a 6-char code + "Open bot" link (`https://t.me/<botname>?start=link_<code>`).
2. Bot webhook handles `/start link_<code>` — verifies/expires code, writes `telegram_user_links` row, replies "✅ Linked as <displayname>. You can now download from the site."
3. Once linked, clicking Download calls `requestDownload({ mediaFileId })` server fn → looks up `telegram_user_links.telegram_user_id` → uses Bot API `copyMessage` (from source channel + `telegram_message_id`) to send into the user's DM → logs result. Returns `{ ok, delivered: true }` and the UI toasts "Sent to your Telegram".
4. Fallback if bot can't DM the user (user never `/start`ed): server returns `{ ok:false, reason:"bot_blocked" }` and UI shows "Open the bot, press Start, then try again".

**Bot commands added:** `/start link_<code>`, `/unlink`, `/whoami` (shows link status).

## Slice 2 — Per-title debug + per-ingest "Force rematch & publish" + audit trail

**Schema:**
- `match_audit_log(id, telegram_ingest_id, master_title_id nullable, attempt_at, scores jsonb {jaccard, containment, substring, total}, rules_used jsonb (snapshot of matching_settings), threshold numeric, decision text ('promoted'|'rejected'|'manual'|'alias'), reason text, actor text ('auto'|'admin:<email>'))` — RLS: admin-only.
- Write a row from `runMatcher` every time it evaluates an ingest.

**Title debug panel (`title.$slug.tsx`):**
- Admin-only collapsible "Debug" section.
- Shows: title's `category`, file counts grouped by `season/episode/quality/language`, all `telegram_ingest` rows whose parsed title scores ≥ 0.3 against this title, each with: score, why-rejected (category mismatch / year mismatch / below threshold / parse-fail), and a "Force match to this title" button.
- Lists the current website query filters being applied (so you can see e.g. "filtered out: status != 'published'").

**Force rematch & publish (single-row):**
- Button on diagnostic panel + on each ingest card → `forceRematchAndPublish({ ingestId })`:
  1. Re-run matcher with current settings, write audit row.
  2. If passes threshold or admin-assigned → auto-promote to `media_files` (existing helper).
  3. Invalidate caches (slice 3) and return the updated media_file payload.
- UI toasts result + refetches the title page.

## Slice 3 — Reindex flow with cache invalidation + homepage index rebuild

The app is TanStack Start (SSR/edge), no Next ISR. Two layers:
- **Server-fn cache busting:** keep a `cache_version` row in `telegram_bot_state`. Every promotion/rematch increments it. All loaders that fetch title/listing data use it as part of their query key and add `Cache-Control: no-store` when called via server route, so the website reflects changes on next nav.
- **Derived index tables (materialized for speed):**
  - `idx_latest_releases(media_file_id, published_at)` — top 50 newly promoted.
  - `idx_trending(master_title_id, score, computed_at)` — based on download_logs last 7d.
  - `idx_search(master_title_id, searchable tsvector)` — for `search.tsx`.
- Admin button **"Rebuild website indexes"** → `rebuildIndexes()` server fn truncates+repopulates the three tables in a transaction, bumps `cache_version`, returns counts.
- **Reindex / Refresh** existing button now also: bumps `cache_version`, runs `rebuildIndexes`, then `router.invalidate()` on the client.

## Slice 4 — Series season/episode organization + download wiring

**On `title.$slug.tsx` for `category='series'`:**
- Group `media_files` by `season_number` then `episode_number`.
- Render an accordion: "Season 1 (12 episodes · 8 available)" → list episodes E01…E12 with status badge (available / missing) and per-quality download buttons.
- Missing episodes shown greyed out with "Not yet ingested".
- Ordering: season asc, episode asc, then quality desc (2160p>1080p>720p>480p).

**Parsing fixes in `telegram-parser.ts`:**
- Recognize `S01E02`, `1x02`, `Season 1 Episode 2`, `EP02`, `- 02 -`. Multi-episode ranges `E01-E03` create three rows.
- Persist parsed `season_number` + `episode_number` on `telegram_ingest`; auto-promotion writes them to `episodes` + links `media_files.episode_id`.

**Download link wiring:**
- Each episode/quality row's Download button calls Slice-1 `requestDownload({ mediaFileId })`.
- For movies (`category='movie'`), same button on the main quality grid.

## Files to touch

- **New:** `supabase/migrations/<ts>_dm_downloads_audit_indexes.sql`, `src/lib/match-audit.server.ts`, `src/lib/downloads.functions.ts`, `src/lib/indexes.server.ts`, `src/components/DownloadButton.tsx`, `src/components/SeasonAccordion.tsx`, `src/components/TitleDebugPanel.tsx`, `src/components/LinkTelegramModal.tsx`.
- **Edited:** `src/routes/api/public/telegram/webhook.ts` (link_/whoami/unlink), `src/lib/telegram-ingest.server.ts` (audit writes, cache_version bump, parser hookup), `src/lib/telegram-parser.ts` (S/E patterns), `src/lib/telegram.functions.ts` (forceRematchAndPublish, rebuildIndexes, requestDownload helpers, getTitleDebug), `src/routes/_authenticated/admin.telegram.tsx` (Rebuild indexes button, per-ingest force-rematch hooked to new fn), `src/routes/title.$slug.tsx` (season accordion, DownloadButton, admin debug panel).

## Order

1. Migration (links, audit, indexes, cache_version, ingest S/E columns).
2. Slice 1 (DM downloads — most user-visible, unblocks testing).
3. Slice 4 (series organization + wire downloads in).
4. Slice 2 (audit + force rematch + title debug).
5. Slice 3 (cache_version + rebuildIndexes + Reindex hookup).

I'll ship each slice in its own turn so you can test as we go. Reply "go" to start with the migration + Slice 1.