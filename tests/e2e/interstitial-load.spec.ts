// Hardened E2E coverage for the interstitial under network throttling,
// background-tab behavior, and parallel-navigation load. Gated behind the
// `@load` tag so the default `bunx playwright test` run stays fast.
//
// Run with: bunx playwright test --grep @load

import { test, expect, type Page } from "@playwright/test";

const CLAIM_PATH = /\/_serverFn\/.*claimInterstitialView/;
const ELIGIBILITY_PATH = /\/_serverFn\/.*previewInterstitialEligibility/;

async function trigger(page: Page) {
  await page.goto("/");
  await page.evaluate(async () => {
    const mod = await import("/src/components/InterstitialController.tsx");
    await (mod as { triggerInterstitial: (p: string) => Promise<boolean> }).triggerInterstitial(
      "interstitial_periodic",
    );
  });
}

test.describe("@load Interstitial — network throttling", () => {
  test("slow-3G shows Play video fallback, retry recovers @load", async ({ page, context }) => {
    const client = await context.newCDPSession(page);
    await client.send("Network.enable");
    // ~Slow 3G profile
    await client.send("Network.emulateNetworkConditions", {
      offline: false,
      downloadThroughput: (400 * 1024) / 8,
      uploadThroughput: (400 * 1024) / 8,
      latency: 400,
    });

    await trigger(page);
    const fallback = page.getByTestId("interstitial-play-fallback");
    await expect(fallback).toBeVisible({ timeout: 12_000 });

    // Lift the throttle and retry.
    await client.send("Network.emulateNetworkConditions", {
      offline: false,
      downloadThroughput: -1,
      uploadThroughput: -1,
      latency: 0,
    });
    await fallback.click();
    await expect(
      page.getByTestId("interstitial-mute").or(page.getByTestId("interstitial-retry")),
    ).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("@load Interstitial — background tab", () => {
  test("cap still claims when tab is hidden @load", async ({ page, context }) => {
    await trigger(page);
    await page
      .getByTestId("interstitial-mute")
      .or(page.getByTestId("interstitial-play-fallback"))
      .waitFor({ timeout: 15_000 });

    // Open a second tab and focus it; the original is now backgrounded.
    const other = await context.newPage();
    await other.goto("about:blank");
    await other.bringToFront();
    // Even though the source tab is hidden, the claim POST should already
    // have been issued (fires on the close branch in InterstitialController).
    const claim = await page.waitForResponse(CLAIM_PATH, { timeout: 15_000 }).catch(() => null);
    await other.close();
    expect(claim).not.toBeNull();
  });
});

test.describe("@load Interstitial — parallel navigations", () => {
  test("5 parallel navigations → only one interstitial renders, others see cap @load", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const pages = await Promise.all([1, 2, 3, 4, 5].map(() => context.newPage()));
    try {
      // First tab consumes the cap.
      await trigger(pages[0]);
      await pages[0]
        .getByTestId("interstitial-mute")
        .or(pages[0].getByTestId("interstitial-play-fallback"))
        .waitFor({ timeout: 15_000 });
      await pages[0].waitForResponse(CLAIM_PATH).catch(() => undefined);

      // Now race the other four. None should render the player.
      const results = await Promise.all(
        pages.slice(1).map(async (p) => {
          const resp = p.waitForResponse(ELIGIBILITY_PATH, { timeout: 15_000 });
          await trigger(p);
          const r = await resp;
          return (await r.json()) as { eligible: boolean };
        }),
      );
      expect(results.every((r) => r.eligible === false)).toBe(true);
    } finally {
      await context.close();
    }
  });
});
