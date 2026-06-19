# Interstitial Hardening Plan (Batch 4)

Four work items. All gated server-side; admin-visible.

## 1. Monitoring & alerting

**Goal:** detect failure spikes and TTFF regressions before users complain.

**Cron route** `src/routes/api/public/hooks/interstitial-health.ts` (POST, apikey-gated, every 5 min via `pg_cron`).
For each `placement` evaluates a rolling 15-min window from `ad_perf_events`, only when `events >= 50`:

- `video_error rate > 10%` → alert `interstitial_video_error_rate`
- `autoplay_blocked rate > 40%` → alert `interstitial_autoplay_blocked_rate`
- `ttff_ms p75 > 3500ms` OR `(p75 / 24h baseline p75) >= 1.5` → alert `interstitial_ttff_regression`

**Alert delivery:**
- Writes to `admin_alerts` (coalesced by `(kind, subject)` — pattern already used by `check_telegram_ingest_grants`).
- On first transition to firing, also pushes to Telegram admin chat via existing `telegram-api.server` helper and `telegram_broadcast_subscribers` (role=admin). Resolved transitions also notify.
- Reuses `admin_audit_log` for each evaluation run.

**Storage:** No new tables. Add `interstitial_alert_state` rows in existing `app_settings` (`key='interstitial_alert_state'`, JSON value) to track last-fired timestamps and prevent flapping (min 30-min re-fire interval).

## 2. Admin dashboard drilldowns + CSV

Replace the single "Interstitial performance (24h)" card in `src/routes/_authenticated/admin.analytics.tsx` with a dedicated route `admin.interstitial-performance.tsx`:

**Filters:** placement (multi), ad_id (multi, autocompleted from recent ads), time range (presets: 1h / 24h / 7d / 30d + custom), bucket (5m/1h/1d auto by range).

**Visualizations (recharts, already in project):**
- TTFF p50/p75/p95 line chart over time
- Buffering ms p75 line
- Dropped frames per session bar
- video_error count + autoplay_blocked count stacked bar
- Pivot table: rows = ad_id, cols = the six metrics with sparkline

**Server fns** (`src/lib/ad-perf-drilldown.functions.ts`, admin-only):
- `getInterstitialDrilldown({ placements, ad_ids, from, to, bucket })` returns timeseries + pivot
- `exportInterstitialPerfCSV({ ...same filters })` returns CSV string (rows: ts, placement, ad_id, metric, value, user_agent_class). Capped at 100k rows; downloads via `Blob` in browser.

All queries use `ad_perf_events` + join `ads.name`. Indexes already on `(placement, created_at)`; add `(ad_id, created_at)` index.

## 3. Server-side frequency caps end-to-end

**Goal:** no interstitial bypassable via reload, incognito tab, or parallel fetches.

**For signed-in users:** keep `ad_view_log` (user_id, placement) — already enforced. Add UNIQUE partial index `(user_id, placement)` WHERE created_at > now() - 24h is not possible (now() not immutable) → instead rely on a SECURITY DEFINER `claim_interstitial_view(_placement)` function that does eligibility check + insert in a single transaction with `FOR UPDATE` row lock on a per-user advisory lock (`pg_advisory_xact_lock(hashtext(user_id::text || placement))`). Eliminates the parallel-request race.

**For anonymous users (new):**
- Issue httpOnly, SameSite=Lax, Secure session cookie `int_sid` (24h) on first interstitial eligibility check via TanStack server fn using `setCookie` from `@tanstack/react-start/server`. Value: 128-bit random base64url.
- New table `ad_view_log_anon(id, session_id, ip_hash, placement, ad_id, user_agent_class, created_at)` — RLS: service_role only; written via SECURITY DEFINER fn.
- Eligibility = no row in last 24h for `(session_id, placement)` AND no row in last 1h for `(ip_hash, placement)` (IP soft fallback prevents cookie-clear bypass while limiting impact behind shared NAT).
- `ip_hash = sha256(ip || daily_salt)` where `daily_salt` rotates from `app_settings` (privacy: not raw IP). IP from `getRequestIP({ xForwardedFor: true })`.
- Same advisory-lock-then-insert pattern.

**Server fn rewrite** `getInterstitialEligibility` and new `claimInterstitialView`:
- Eligibility is now read-only preview; the actual cap is claimed by `claimInterstitialView` called from `VideoInterstitial` `onPlaying` (the existing analytics point). Two-phase prevents showing-without-claiming if user closes tab mid-load.

## 4. Playwright E2E

`tests/e2e/interstitial.spec.ts` (Playwright; install with `bun add -D @playwright/test` + `npx playwright install --with-deps chromium webkit`).

Three projects in `playwright.config.ts`:
- `chromium-android` — mobile Pixel device descriptor + Chromium launch flag `--autoplay-policy=user-gesture-required`
- `webkit-ios` — iPhone 13 device descriptor (WebKit naturally blocks autoplay)
- `chromium-desktop` — baseline, autoplay allowed

**Tests:**
1. Autoplay blocked → fallback UI appears, "Play video" button visible, click resumes playback, `ad_perf_events` POST with `autoplay_blocked` then `ttff_ms` recorded (network intercept).
2. Retry flow: stub video src to fail twice then succeed; assert 2 retry network events then success.
3. Frequency cap: trigger interstitial → reload → assert no second interstitial within 24h (cookie persists).
4. Parallel-request race: fire two eligibility calls simultaneously via `Promise.all` from page context → exactly one claim succeeds.
5. Analytics firing on iOS WebKit: assert `recordAdPerfEvent` POSTs for `ttff_ms`, `buffer_ms`, `dropped_frames`.

Tests target `http://localhost:8080`, seed an interstitial ad via admin server fn beforeEach, sign in test user using existing `LOVABLE_BROWSER_SUPABASE_*` env mechanism for the authenticated cases.

## Migrations

```sql
-- 1. Drilldown index
CREATE INDEX IF NOT EXISTS ad_perf_events_ad_id_created_idx
  ON public.ad_perf_events (ad_id, created_at DESC);

-- 2. Anon session view log
CREATE TABLE public.ad_view_log_anon (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  ip_hash text NOT NULL,
  placement text NOT NULL,
  ad_id uuid REFERENCES public.ads(id) ON DELETE SET NULL,
  user_agent_class text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.ad_view_log_anon TO service_role;
ALTER TABLE public.ad_view_log_anon ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service only" ON public.ad_view_log_anon FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX ad_view_log_anon_sid_placement_idx ON public.ad_view_log_anon (session_id, placement, created_at DESC);
CREATE INDEX ad_view_log_anon_iph_placement_idx ON public.ad_view_log_anon (ip_hash, placement, created_at DESC);

-- 3. SECURITY DEFINER claim functions
CREATE OR REPLACE FUNCTION public.claim_interstitial_view_user(_user_id uuid, _placement text, _ad_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE existing_at timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(_user_id::text || ':' || _placement));
  SELECT created_at INTO existing_at FROM ad_view_log
    WHERE user_id=_user_id AND placement=_placement AND created_at > now()-interval '24 hours'
    ORDER BY created_at DESC LIMIT 1;
  IF existing_at IS NOT NULL THEN
    RETURN jsonb_build_object('claimed', false, 'next_allowed_at', existing_at + interval '24 hours');
  END IF;
  INSERT INTO ad_view_log(user_id, placement, ad_id) VALUES (_user_id, _placement, _ad_id);
  RETURN jsonb_build_object('claimed', true);
END $$;

-- analogous claim_interstitial_view_anon(_session_id, _ip_hash, _placement, _ad_id, _ua text)
```

## Files

**New:**
- `src/routes/api/public/hooks/interstitial-health.ts`
- `src/lib/interstitial-cap.functions.ts` (eligibility preview + claim, anon + auth)
- `src/lib/ad-perf-drilldown.functions.ts`
- `src/lib/interstitial-alerting.server.ts` (threshold eval, telegram delivery)
- `src/routes/_authenticated/admin.interstitial-performance.tsx`
- `tests/e2e/interstitial.spec.ts`, `playwright.config.ts`

**Edited:**
- `src/components/InterstitialController.tsx` (call new eligibility for any placement, not just auth)
- `src/components/VideoInterstitial.tsx` (call `claimInterstitialView` on `onPlaying`)
- `src/lib/interstitial-eligibility.functions.ts` (deprecate; thin shim → new module)
- `src/routes/_authenticated/admin.analytics.tsx` (replace tile w/ link to drilldown page)

**Migrations:** indexes + anon table + claim functions (one file).
**Cron seed:** insert via `supabase--insert` after route deploys.

## Out of scope
- Per-placement threshold UI (admin currently hardcoded; can move to `app_settings` later).
- Cross-device dedup for anon beyond IP fallback.
- Email delivery of alerts (Telegram + in-app only).
- Playwright in CI pipeline wiring (tests added, runner config provided, CI hookup separate).
