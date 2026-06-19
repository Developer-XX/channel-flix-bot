// E2E coverage for the interstitial ad component across iOS Safari (WebKit),
// Android Chromium (autoplay blocked), and desktop Chromium (autoplay
// allowed). Verifies:
//
//   1. Autoplay-blocked fallback UI appears and Play button resumes playback
//   2. Retry flow after a transient video load error
//   3. Per-session frequency cap (server-issued cookie persists across reload)
//   4. Parallel-request race resolves to exactly one claim
//   5. Analytics events (ttff_ms, buffer_ms, autoplay_blocked) reach the server
//
// These are skeleton specs — they require a test ad seeded for the
// `interstitial_login` placement and run against a local dev server.
// `bunx playwright test` runs all three browser profiles defined in
// playwright.config.ts.

import { test, expect, type Page, type Request } from "@playwright/test";

const PERF_PATH = /\/_serverFn\/.*recordAdPerfEvent/;
const CLAIM_PATH = /\/_serverFn\/.*claimInterstitialView/;
const ELIGIBILITY_PATH = /\/_serverFn\/.*previewInterstitialEligibility/;

async function captureAdEvents(page: Page) {
  const events: Array<{ name: string; detail: unknown }> = [];
  await page.exposeFunction("__captureInterstitialEvent", (name: string, detail: unknown) => {
    events.push({ name, detail });
  });
  await page.addInitScript(() => {
    const names = [
      "ad_load_start",
      "ad_load_success",
      "ad_load_error",
      "ad_play_success",
      "ad_autoplay_blocked",
      "ad_mute",
      "ad_unmute",
      "ad_video_error",
      "ad_timeout",
      "ad_retry",
    ];
    for (const n of names) {
      window.addEventListener(`interstitial:${n}`, (e) => {
        const detail = (e as CustomEvent).detail;
        (window as unknown as {
          __captureInterstitialEvent?: (n: string, d: unknown) => void;
        }).__captureInterstitialEvent?.(n, detail);
      });
    }
  });
  return events;
}

async function triggerInterstitial(page: Page) {
  await page.goto("/");
  await page.evaluate(async () => {
    const mod = await import("/src/components/InterstitialController.tsx");
    await (mod as { triggerInterstitial: (p: string) => Promise<boolean> }).triggerInterstitial(
      "interstitial_periodic",
    );
  });
}

test.describe("Interstitial — autoplay fallback", () => {
  test("renders Play video fallback when autoplay is blocked", async ({ page, browserName }) => {
    test.skip(browserName === "chromium" && !test.info().project.name.includes("android"),
      "Desktop Chromium allows muted autoplay; fallback only fires on iOS/Android");
    const events = await captureAdEvents(page);
    await triggerInterstitial(page);

    const fallback = page.getByTestId("interstitial-play-fallback");
    await expect(fallback).toBeVisible({ timeout: 15_000 });
    await fallback.click();

    await expect(page.getByTestId("interstitial-mute")).toBeVisible({ timeout: 10_000 });
    expect(events.some((e) => e.name === "ad_autoplay_blocked")).toBe(true);
    expect(events.some((e) => e.name === "ad_play_success")).toBe(true);
  });
});

test.describe("Interstitial — retry", () => {
  test("retries once on transient video error", async ({ page }) => {
    const events = await captureAdEvents(page);
    let videoHits = 0;
    await page.route(/\.mp4(\?|$)/, (route) => {
      videoHits += 1;
      if (videoHits === 1) return route.fulfill({ status: 500, body: "" });
      return route.continue();
    });
    await triggerInterstitial(page);
    await expect(page.getByTestId("interstitial-mute").or(page.getByTestId("interstitial-play-fallback")))
      .toBeVisible({ timeout: 15_000 });
    expect(events.some((e) => e.name === "ad_retry")).toBe(true);
  });
});

test.describe("Interstitial — frequency cap", () => {
  test("does not show again within 24h of a successful render", async ({ page }) => {
    await triggerInterstitial(page);
    await page.getByTestId("interstitial-play-fallback").or(page.getByTestId("interstitial-mute"))
      .waitFor({ timeout: 15_000 });

    // Wait for the claim POST to settle.
    await page.waitForResponse(CLAIM_PATH).catch(() => undefined);

    // Reload — cookie persists, eligibility should return false.
    await page.reload();
    const eligibilityResp = page.waitForResponse(ELIGIBILITY_PATH);
    await page.evaluate(async () => {
      const mod = await import("/src/components/InterstitialController.tsx");
      await (mod as { triggerInterstitial: (p: string) => Promise<boolean> }).triggerInterstitial(
        "interstitial_periodic",
      );
    });
    const resp = await eligibilityResp;
    const body = await resp.json();
    expect(body.eligible).toBe(false);
  });
});

test.describe("Interstitial — parallel claim race", () => {
  test("two simultaneous claims → exactly one succeeds", async ({ page }) => {
    await page.goto("/");
    const responses = await page.evaluate(async () => {
      const { claimInterstitialView } = await import(
        "/src/lib/interstitial-cap.functions.ts"
      );
      const fn = claimInterstitialView as (args: { data: { placement: string } }) => Promise<{ claimed: boolean }>;
      const r = await Promise.all([
        fn({ data: { placement: "interstitial_periodic" } }),
        fn({ data: { placement: "interstitial_periodic" } }),
      ]);
      return r;
    });
    const claimed = responses.filter((r) => r.claimed).length;
    expect(claimed).toBe(1);
  });
});

test.describe("Interstitial — analytics", () => {
  test("emits perf events to recordAdPerfEvent", async ({ page }) => {
    const perfRequests: Request[] = [];
    page.on("request", (req) => {
      if (PERF_PATH.test(req.url())) perfRequests.push(req);
    });
    await triggerInterstitial(page);
    await page
      .getByTestId("interstitial-mute")
      .or(page.getByTestId("interstitial-play-fallback"))
      .waitFor({ timeout: 15_000 });
    if (await page.getByTestId("interstitial-play-fallback").isVisible().catch(() => false)) {
      await page.getByTestId("interstitial-play-fallback").click();
    }
    // Allow some buffer time for ttff / buffer events to fire.
    await page.waitForTimeout(3000);
    expect(perfRequests.length).toBeGreaterThan(0);
  });
});
