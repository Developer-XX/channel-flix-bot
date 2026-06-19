# Interstitial Hardening Plan

Four work items, sequenced so each one is independently verifiable.

---

## 1. Per-user 24h frequency cap

**Goal:** the login-style interstitial (`interstitial_login`) shows at most once per 24h per signed-in user, surviving reloads, tab close, and device switches.

- New table `public.ad_view_log`
  - Columns: `id uuid pk`, `user_id uuid not null`, `placement text not null`, `ad_id uuid null`, `created_at timestamptz default now()`.
  - Indexes: `(user_id, placement, created_at desc)`.
  - RLS: users `SELECT` their own rows; `service_role` full; no anon.
  - Grants per project policy.
- New server fn `getInterstitialEligibility({ placement })`
  - Auth via `requireSupabaseAuth`.
  - Returns `{ eligible: boolean, nextAllowedAt: string | null }`.
  - For `interstitial_login`: looks up last row in last 24h.
- New server fn `recordInterstitialView({ placement, ad_id })` (auth required) → inserts row.
- Wire into `InterstitialController`:
  - Before resolving `show("interstitial_login")`, await eligibility check; if not eligible, resolve `false`.
  - After a successful play (reason !== "no-ad"), call `recordInterstitialView`.
- Keep existing `localStorage` cooldown for `interstitial_periodic` and `interstitial_before_download` (anonymous-safe; lighter weight). 24h cap applies only to the user-anchored login placement.

## 2. Perf metrics — `ad_perf_events` + admin tile

**Goal:** capture TTFF (time-to-first-frame), buffering duration, dropped-frame count for served interstitials, and show 24h aggregates in the admin analytics dashboard.

- New table `public.ad_perf_events`
  - Columns: `id uuid pk`, `ad_id uuid null`, `placement text not null`, `metric text not null check (metric in ('ttff_ms','buffer_ms','dropped_frames','autoplay_blocked','video_error'))`, `value numeric not null default 0`, `user_agent text`, `created_at timestamptz default now()`.
  - Indexes: `(placement, metric, created_at desc)`, `(ad_id, created_at desc)`.
  - RLS: `service_role` full; admins `SELECT` via `has_role(auth.uid(),'admin')`; `INSERT` allowed for `authenticated` and `anon` with bounded zod validation (so anonymous interstitial impressions are still measurable). No `SELECT` for anon.
  - Grants accordingly.
- New server fn `recordAdPerfEvent({ ad_id, placement, metric, value })`
  - Public (no auth middleware) so login-page anon hits work.
  - Zod-validated: metric is a fixed enum, value clamped 0..600000 numeric, user_agent truncated to 256.
  - Uses server publishable client; relies on RLS `INSERT` policy.
- New server fn `getAdPerfSummary({ windowHours })` (admin-only)
  - Returns `{ ttff_p50, ttff_p95, buffer_avg_ms, dropped_frames_total, autoplay_blocked_count, error_count, samples }` per placement.
- `VideoInterstitial` integration:
  - Record `performance.now()` at video element mount; on first `onPlaying`, post `ttff_ms`.
  - Sum `waiting`→`playing` gaps for `buffer_ms`; flush once on close.
  - On close, read `video.getVideoPlaybackQuality?.()` and post `dropped_frames`.
  - Post `autoplay_blocked` / `video_error` once per occurrence.
- Admin dashboard: add a "Interstitial performance (24h)" card to `src/routes/_authenticated/admin.analytics.tsx` showing the 6 summary numbers per placement.

## 3. iOS Safari / Android Chrome fallback UI

**Goal:** when autoplay is blocked or first-frame never lands, swap inline player for a full-screen player chrome with a static thumbnail (poster) and a clear "Play video" button. Single tap starts playback with sound and counts as the impression.

- Extend `VideoInterstitial`:
  - Detect blocked autoplay either from caught `play()` rejection or from the existing 8s timeout watchdog.
  - Render a full-bleed `<div>` covering the dialog frame with: ad poster (`ad.poster_url ?? first-frame screenshot via `preload="metadata"` snapshot fallback), centered large `Play` button, advertiser name, "Sponsored" badge.
  - Button onClick: unmute + `video.play()` from the gesture; on success, transition back to normal player; on failure, retry once muted then degrade to skippable static thumbnail (countdown still runs, `Continue` button appears at cancel-time).
- No schema change. `ad.poster_url` already exists on the `ads` row; falls back to a black rectangle when missing.

## 4. Tests

Vitest + React Testing Library where possible; one Playwright spec for cross-browser autoplay behaviour.

- **`src/components/__tests__/VideoInterstitial.test.tsx`** (jsdom)
  - Mocks `useServerFn` for `listActiveAds` + `recordAdEvent` + `recordAdPerfEvent`.
  - Mocks `HTMLMediaElement.prototype.play` returning resolved / rejected promises.
  - Cases:
    - Skeleton renders before ad resolves; container preserves `aspect-video` (no layout shift).
    - Error state renders with Retry; clicking Retry calls `listActiveAds` again.
    - Autoplay-blocked path renders the fallback "Play video" thumbnail and unblocks on click.
    - Timeout watchdog fires `interstitial:ad_timeout` CustomEvent after 8s (fake timers).
    - Successful play emits `interstitial:ad_play_success` + records `view` server event.
    - Mute toggle emits `interstitial:ad_mute` / `:ad_unmute`.
- **`src/lib/__tests__/interstitial-eligibility.test.ts`**
  - Pure server-fn unit: mocks `context.supabase.from('ad_view_log')`; asserts eligibility window math.
- **`tests/e2e/interstitial-autoplay.spec.ts`** (Playwright)
  - Chromium with autoplay policy `no-user-gesture-required` → expects video to play automatically.
  - Chromium with autoplay policy `user-gesture-required` → expects fallback "Play video" thumbnail, click starts playback.

## 5. Verification pass

After implementation:
- `bunx vitest run` (component + lib tests).
- Playwright spec for autoplay.
- `invoke-server-function` smoke test for `getInterstitialEligibility` + `recordAdPerfEvent`.
- Drive the live preview with Playwright headless on the auth page to confirm the fallback renders end-to-end and the impression / view server events fire.
- Visit `/_authenticated/admin/analytics` and screenshot the new perf tile with seeded events.

---

## Technical details

### Migrations

```sql
-- ad_view_log
CREATE TABLE public.ad_view_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  placement text NOT NULL,
  ad_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ad_view_log_user_placement_idx
  ON public.ad_view_log (user_id, placement, created_at DESC);
GRANT SELECT, INSERT ON public.ad_view_log TO authenticated;
GRANT ALL ON public.ad_view_log TO service_role;
ALTER TABLE public.ad_view_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own ad views" ON public.ad_view_log
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "users insert own ad views" ON public.ad_view_log
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- ad_perf_events
CREATE TABLE public.ad_perf_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_id uuid NULL,
  placement text NOT NULL,
  metric text NOT NULL CHECK (metric IN
    ('ttff_ms','buffer_ms','dropped_frames','autoplay_blocked','video_error')),
  value numeric NOT NULL DEFAULT 0,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ad_perf_events_lookup_idx
  ON public.ad_perf_events (placement, metric, created_at DESC);
GRANT INSERT ON public.ad_perf_events TO anon, authenticated;
GRANT SELECT ON public.ad_perf_events TO authenticated;
GRANT ALL ON public.ad_perf_events TO service_role;
ALTER TABLE public.ad_perf_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "perf insert open" ON public.ad_perf_events
  FOR INSERT TO anon, authenticated WITH CHECK (
    length(placement) <= 64 AND
    (user_agent IS NULL OR length(user_agent) <= 256) AND
    value >= 0 AND value <= 600000
  );
CREATE POLICY "admins read perf" ON public.ad_perf_events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
```

### File touch list

- new: `supabase/migrations/<ts>_ad_view_log_and_perf.sql`
- new: `src/lib/interstitial-eligibility.functions.ts`
- new: `src/lib/ad-perf.functions.ts`
- edit: `src/components/InterstitialController.tsx` (eligibility gate + recordView call)
- edit: `src/components/VideoInterstitial.tsx` (perf events + fallback thumbnail UI)
- edit: `src/routes/_authenticated/admin.analytics.tsx` (perf summary tile)
- new: `src/components/__tests__/VideoInterstitial.test.tsx`
- new: `src/lib/__tests__/interstitial-eligibility.test.ts`
- new: `tests/e2e/interstitial-autoplay.spec.ts`

### Out of scope

- Backend rate limiting on `recordAdPerfEvent` beyond the RLS WITH CHECK bounds (project policy).
- Cross-device dedup for anon users (no stable id).
- Per-placement cap UI in admin settings — current admin `cancelSeconds` / cooldown controls stay as-is.
