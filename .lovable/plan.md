# Plan: Baselines, Server-Validated Perf, Hardened E2E

## 1. 7/14/30-day baseline drilldown (admin)

Extend `src/routes/_authenticated/admin.interstitial-performance.tsx` with a new "Baselines & Regressions" panel above the existing filters.

- New server fn `getInterstitialBaselines` in `src/lib/ad-perf-drilldown.functions.ts`:
  - Returns, for each metric (`ttff_p75`, `video_error_rate`, `autoplay_blocked_rate`):
    - `current` (last 24h)
    - `baseline_7d`, `baseline_14d`, `baseline_30d` (rolling, excluding last 24h)
    - `delta_pct` per window and a `regressed` boolean
  - Optional `placement` filter (reuses existing filter state).
- Regression rule (matches the conservative alert thresholds already in cron):
  - TTFF p75: regressed if `current > 3500ms` OR `current / baseline >= 1.5`.
  - `video_error_rate`: regressed if `current > 0.10` OR `current - baseline >= 0.05`.
  - `autoplay_blocked_rate`: regressed if `current > 0.40` OR `current - baseline >= 0.15`.
- UI: 3x3 grid of metric cards (rows=metric, cols=7/14/30). Regressed cells get a destructive border + arrow icon + `aria-label`. A summary banner at the top lists any regressed `(metric, window)` pairs.
- SQL: single RPC `interstitial_baselines(_placement text)` returning a `jsonb` aggregate to avoid 9 round-trips. Reads from `ad_perf_events` and `ad_events`.

## 2. Server-validated TTFF / buffering via request IDs

Problem: today the client posts `ttff_ms`, `buffering_ms`, `dropped_frames` directly. Browsers disagree; values are trustable only as hints.

Solution: correlate to a server-issued `request_id` and store both client-reported and server-derived timestamps so the server can validate/normalize.

- Migration:
  - Add `request_id uuid` and `server_received_at timestamptz` columns to `ad_perf_events` (nullable for back-compat, indexed on `request_id`).
  - New table `ad_perf_requests(request_id uuid pk, ad_id uuid, placement text, user_id uuid null, session_id text null, issued_at timestamptz default now(), first_byte_at, first_frame_at, ended_at, ua_class text)`. GRANTs + RLS service_role only.
- New server fn `issueInterstitialRequest({ ad_id, placement })` → returns `{ request_id, signed_url? }`. Called by `InterstitialController` BEFORE `<video>` mount.
- New public route `src/routes/api/public/hooks/interstitial-beacon.ts` (POST, signed with `request_id` + HMAC of `CRON_SECRET`'s sibling new `BEACON_SECRET`): receives `{ request_id, phase: 'first_byte'|'first_frame'|'buffer_start'|'buffer_end'|'dropped_frame'|'end', client_ts }`. Server writes `ad_perf_requests` timestamps; computes authoritative TTFF as `first_frame_at - issued_at` server-side.
- `ad_perf_events` write path becomes: client still sends hints, but a trigger / cron job (`reconcile_ad_perf_events`, every 1 min) overwrites `ttff_ms`, `buffering_ms`, `dropped_frames` from `ad_perf_requests` when `request_id` is present and complete. Adds `is_server_validated boolean`.
- `VideoInterstitial.tsx`:
  - Accept `requestId` prop; emit beacons via `navigator.sendBeacon` on each lifecycle event (`loadeddata`, `playing`, `waiting`, `playing` again, `ended`, `error`). Falls back to fetch keepalive.
  - Dropped frames via `requestVideoFrameCallback` (Chrome/Safari) or `getVideoPlaybackQuality()` polled at 1 Hz; emit deltas.
- Drilldown + baselines read only `is_server_validated = true` by default with a toggle to include client-only rows.

## 3. Hardened Playwright E2E

Extend `tests/e2e/interstitial.spec.ts`; add `tests/e2e/interstitial-load.spec.ts`.

- **Network throttling**: per-test CDP `Network.emulateNetworkConditions` profiles (`slow-3g`, `regular-4g`). Asserts:
  - Slow-3G: fallback "Play video" appears within 8s when first-frame budget exceeded.
  - Retry button recovers playback once throttling is removed.
- **Background tab**: open a second tab, switch focus during playback. Assert that frequency-cap claim still fires once (via beacon end), and `visibilitychange→hidden` pauses metric collection but not the cap.
- **Parallel navigations**: in a single context, open 5 tabs simultaneously to a route with the interstitial. Assert exactly one tab is allowed to play; the other 4 see the cap-skipped state. Validates `pg_advisory_xact_lock` end-to-end.
- Add a 4th project `chromium-throttled` to `playwright.config.ts`. Mark load spec as `@load` and exclude from default `test` script; expose `test:load` npm script.

## 4. Post-build verification pass

After implementing 1–3:
- Run `bunx vitest run` (existing unit + integration tests).
- Run `bunx playwright test --project=chromium-desktop` smoke only (load specs gated behind `@load`).
- Invoke `/api/public/hooks/interstitial-health` once and verify `admin_alerts` coalescing still works after the new `is_server_validated` filter.
- Open `/admin/interstitial-performance` via Playwright with the signed-in session and screenshot the new baselines panel; confirm regressed cells render.
- Read `stack_modern--server-function-logs` for any SSR errors from the new server fns.
- Fix anything that surfaces, then report.

## Technical notes

- All new tables/columns ship with GRANTs in the same migration (per `public-schema-grants`).
- Beacon endpoint goes under `/api/public/*` and uses HMAC verification; no PII returned.
- `issueInterstitialRequest` is unauthenticated (anon interstitials must work) but rate-limited via existing `rl_hit`.
- No edits to `src/integrations/supabase/{client,client.server,types,auth-*}.ts` except regenerated `types.ts` after migration.

## Out of scope

- Per-metric custom regression thresholds in admin UI (uses the conservative defaults already agreed).
- Migrating historical `ad_perf_events` rows to `is_server_validated`.
- Real device cloud (BrowserStack/Sauce) for Playwright.
