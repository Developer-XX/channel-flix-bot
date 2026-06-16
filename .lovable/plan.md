# Plan

## 1. Fix layout / responsive issues on title pages
**Files:** `src/routes/title.$slug.tsx`, `src/components/SeasonAccordion.tsx`, `src/components/DownloadButton.tsx`

Symptoms in screenshots:
- Header (logo + nav + search + admin/account) wraps over the poster on narrow desktop widths (~800–1100px). Cause: header uses `flex` without `min-w-0`/grid, and the title hero column doesn't reserve enough width.
- Episode rows occasionally hide the filename or button when the window is small (Doraemon "movie file sometimes shows, sometimes not"). Cause: leftover `lg:grid-cols-2` packing in season body + missing `min-w-0` on filename text wrapper.

Fixes:
- Rewrite header row as `grid grid-cols-[auto_minmax(0,1fr)_auto]` on mobile, `flex` at `lg:`; add `min-w-0` to nav, `truncate` to brand.
- Hero: switch to `grid grid-cols-1 md:grid-cols-[auto_minmax(0,1fr)]` so poster + text always coexist.
- Episode rows: single `grid grid-cols-[auto_minmax(0,1fr)_auto]` at all widths, `xl:grid-cols-2` only for the *outer* season list. Add `min-w-0 truncate` on every text container, `shrink-0` on icon + button.

## 2. Ensure Doraemon (and similar) files always render
**Files:** `src/lib/episode-resolution.ts`, `src/routes/title.$slug.tsx`

Audit the resolver to:
- Always return movie files in a synthetic "Movie" group when `category=movie` (never depend on `seasons` table).
- Sort by quality/language deterministically so SSR + client match (prevents the "sometimes visible" hydration flash).

## 3. Chhota Bheem: episodes in debug but not in series body
Root cause to investigate: `idx_search` / `master_titles` join might be filtering by `season_number` from `seasons` table while the matched files have `season_number=18` only on `media_files`. I'll inspect the resolver and either backfill `seasons` rows for manually-added titles or fall back to grouping by `media_files.season_number` when no `seasons` row exists.

## 4. New admin page: Verification rate-limit audit
**New file:** `src/routes/_authenticated/admin.verification-limits.tsx`
**New server fn:** `listVerificationRateLimits` in `src/lib/admin.functions.ts`

Shows recent rows from `verification_provider_calls` (and a new view over rate-limit rejections in `match_audit_log`) with: timestamp, user id, token, file id/name, reason, retry-after. Filterable by user/date.

Migration: add `rate_limit` event type to whatever audit table currently logs verification (likely `verification_provider_calls` already; if not, add a `verification_rate_limit_events` table).

## 5. Debug Visibility mode on series pages
**Files:** `src/routes/title.$slug.tsx`, `src/components/TitleDebugPanel.tsx`

Add a `?debug=1` query (admin-gated) that shows, per episode group:
- raw `media_files` rows fetched
- which were filtered out and why (RLS denial, missing season, language mismatch)
- the exact SQL filters used

Wire it through a new `getTitleDebugInfo` server fn that returns counts + sample rejected rows.

## 6. Admin button: Re-run Telegram sync for a title/channel
**Files:** `src/routes/_authenticated/admin.titles.tsx`, `src/lib/telegram.functions.ts`

Add `resyncTitle(masterTitleId)` server fn that:
- Re-scans `telegram_ingest` rows for the title's channel(s)
- Re-runs the matcher only against those rows
- Rebuilds `media_files` + `seasons` + `episodes` for that title
- Invalidates indexes

Button lives on the admin title row + on the Title Debug panel.

## 7. Automated responsive tests for SeasonAccordion
**New file:** `src/components/__tests__/SeasonAccordion.responsive.test.tsx`

Using vitest + jsdom + `@testing-library/react`:
- Render SeasonAccordion with mocked 24 episodes
- At simulated widths 320, 375, 414, 768, 1024, 1280, 1536:
  - assert every episode filename node is in the DOM
  - assert the download button is in the DOM and not `aria-hidden`
  - assert no element overflows its parent (check `scrollWidth <= clientWidth` on rows via a lightweight layout shim)

jsdom doesn't do real layout, so the overflow check uses a CSS-class assertion (presence of `min-w-0`, `truncate`, `shrink-0` on the right nodes) rather than pixel math. Pixel-perfect checks would need Playwright; flag this if you want true visual regression.

## 8. Out of scope (call out)
- Real visual-regression (Playwright/Percy) — not set up; tests above are structural.
- Reworking the whole header/nav design — only responsive fixes, no redesign.

---

## Open questions
1. For the **resync button** — should it also re-pull from Telegram API (slow, may hit rate limits) or only re-run the matcher over already-ingested rows (fast)? I'll default to **re-run matcher only** unless you say otherwise.
2. The **debug visibility mode** — admin-only via `has_role('admin')`, or also available to any signed-in user with `?debug=1`? Default: **admin only**.
3. Rate-limit audit page — keep history forever, or auto-prune after 30 days? Default: **keep 30 days** with a daily cleanup job.

Reply "go" (or with answers) and I'll execute steps 1–7 in order.