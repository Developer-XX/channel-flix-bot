This is a large batch of work. I'll group it into 5 deliverables and ship them in this order so each builds on the previous. Tell me to start, or reorder.

## 1. Telegram sync + episode visibility logging
- New table `sync_trace_log` (run_id, title_id, channel_id, phase, message_id, decision, reason_code, details jsonb, created_at) with admin-only RLS.
- Instrument `telegram-resync-recent` and the on-demand "Resync series" admin button to write one row per evaluated message with codes: `MATCHED`, `SKIPPED_TITLE_MISMATCH`, `SKIPPED_SEASON_PARSE`, `SKIPPED_NO_MEDIA`, `PROMOTED`, `REJECTED_DUPLICATE`, `RLS_HIDDEN`, etc.
- New admin page `/admin/sync-trace` with filter by title + run_id, CSV export.

## 2. Per-episode debug panel with error codes
- Extend the existing `TitleDebugPanel`: for each ingested message that did NOT produce a visible episode, show the rule that hid it.
- Reason codes: `INGEST_MISSING`, `INGEST_UNMATCHED_TITLE`, `SEASON_PARSE_FAILED`, `EPISODE_NUMBER_MISSING`, `MEDIA_FILE_MISSING`, `RLS_REJECTED`, `API_FILTER_EXCLUDED`, `DUPLICATE_OF_<id>`.
- Source data from `sync_trace_log` joined with `telegram_ingest` + `episodes`.
- Visible only to admins; toggle persists in localStorage.

## 3. /admin access flow fix + auth audit page
- Audit current flow: `_authenticated/route.tsx` gate → `getUser()` → `has_role('admin')` check inside admin loader.
- Fix any race where the session is hydrated after the gate runs (move role check into a server fn that re-reads JWT claims; surface 403 with a friendly screen instead of redirect-loop to /auth).
- New page `/admin/auth-diagnostics` running a sequence of checks for the current user:
  - `SESSION_PRESENT`, `JWT_VALID`, `JWT_EXPIRES_IN`, `USER_ID_RESOLVED`, `PROFILE_ROW_PRESENT`, `ROLE_ADMIN`, `RESET_PASSWORD_ROUTE_REACHABLE`, `LOGIN_ROUNDTRIP_OK`.
  - Each check returns `{code, status, detail}`; failures show remediation.

## 4. E2E auth audit script
- Server function `runAuthAudit(email)` (admin-only) that exercises register/login/reset/JWT/role using the Auth Admin API against a disposable test account, returning per-step codes.
- Wired into the diagnostics page with a "Run full audit" button.

## 5. Playwright responsive E2E
- Add Playwright (`@playwright/test`), `playwright.config.ts`, GitHub-style `e2e/` folder.
- Test `episode-visibility.spec.ts`: for each title slug in a seed list, at viewports 320/360/390/414/768, assert every `[data-testid="episode-row"]` and its `[data-testid="download-btn"]` is visible and in the viewport, and `click()` succeeds (intercepts navigation).
- Add `data-testid` hooks in `SeasonAccordion` and `DownloadButton`.
- npm script `test:e2e`.

## Technical notes
- All new tables follow GRANT → RLS → POLICY order, admin-only via `has_role(auth.uid(),'admin')`.
- Logging uses `supabaseAdmin` inside server handlers only.
- Diagnostics never log secrets or full JWTs — only `exp`, `iat`, claim presence booleans.
- Playwright runs against the published preview URL; no auth required for title pages.

Reply "go" to execute all 5 in order, or pick a subset (e.g. "1, 3, 5 only").
