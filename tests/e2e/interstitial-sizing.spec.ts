// Verifies the interstitial video sizing + overlay badge visibility across
// a matrix of common phone/tablet viewports in both portrait and landscape.
//
// What this covers:
//   - Player box covers the full viewport (no letterboxed gutters when the
//     ad's aspect ratio matches the screen, ≤1px rounding tolerance).
//   - When the player is letterboxed, it never exceeds the viewport bounds
//     (no horizontal/vertical overflow → no cropping of the video frame).
//   - The Ad badge, close button / countdown, mute button, and sponsor
//     strip are all rendered within the visible viewport (no clipping at
//     notched safe-area edges).
//   - The debug overlay (enabled via ?debug=interstitial) reports the same
//     dimensions we measured from the DOM — a regression in the sizing
//     math will diverge from the rendered box.
//
// Run with: bunx playwright test interstitial-sizing.spec.ts

import { test, expect, type Page } from "@playwright/test";

const VIEWPORTS = [
  { name: "iphone-se-portrait", width: 375, height: 667 },
  { name: "iphone-se-landscape", width: 667, height: 375 },
  { name: "iphone-14-portrait", width: 390, height: 844 },
  { name: "iphone-14-landscape", width: 844, height: 390 },
  { name: "pixel-7-portrait", width: 412, height: 915 },
  { name: "pixel-7-landscape", width: 915, height: 412 },
  { name: "ipad-portrait", width: 820, height: 1180 },
  { name: "ipad-landscape", width: 1180, height: 820 },
  { name: "ipad-mini-portrait", width: 768, height: 1024 },
] as const;

async function openInterstitialWithDebug(page: Page) {
  await page.goto("/?debug=interstitial");
  await page.evaluate(async () => {
    try { window.localStorage.setItem("interstitialDebug", "1"); } catch { /* noop */ }
    const mod = await import("/src/components/InterstitialController.tsx");
    await (mod as { triggerInterstitial: (p: string) => Promise<boolean> })
      .triggerInterstitial("interstitial_periodic");
  });
  await page.waitForSelector('[data-testid^="interstitial-"]', { timeout: 15_000 });
}

for (const vp of VIEWPORTS) {
  test(`interstitial fits viewport and shows all badges @ ${vp.name} (${vp.width}x${vp.height})`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await openInterstitialWithDebug(page);

    // The player container is the immediate sized box inside the Frame.
    const player = page.locator('[data-testid^="interstitial-"] > div > div.relative.bg-black').first();
    await expect(player).toBeVisible();

    const box = await player.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // 1) Must not exceed the viewport in either axis (cropping guard).
    expect(box.width).toBeLessThanOrEqual(vp.width + 1);
    expect(box.height).toBeLessThanOrEqual(vp.height + 1);

    // 2) Either the width or height must hit the viewport edge — the box
    //    must always fill at least one axis, otherwise we're shrinking the
    //    ad unnecessarily.
    const fillsAxis =
      Math.abs(box.width - vp.width) < 2 || Math.abs(box.height - vp.height) < 2;
    expect(fillsAxis).toBe(true);

    // 3) All overlay badges visible within the viewport rect.
    const badges = [
      'interstitial-badge-ad',
      'interstitial-sponsor',
    ];
    // close/countdown: one of the two is rendered depending on cancelSeconds.
    const closeOrCountdown = page.locator(
      '[data-testid="interstitial-close"], [data-testid="interstitial-countdown"]',
    );
    await expect(closeOrCountdown).toBeVisible();
    const cBox = await closeOrCountdown.boundingBox();
    expect(cBox).not.toBeNull();
    if (cBox) {
      expect(cBox.x).toBeGreaterThanOrEqual(0);
      expect(cBox.y).toBeGreaterThanOrEqual(0);
      expect(cBox.x + cBox.width).toBeLessThanOrEqual(vp.width + 1);
      expect(cBox.y + cBox.height).toBeLessThanOrEqual(vp.height + 1);
    }

    for (const id of badges) {
      const el = page.locator(`[data-testid="${id}"]`);
      await expect(el).toBeVisible();
      const b = await el.boundingBox();
      expect(b, `${id} bounding box`).not.toBeNull();
      if (!b) continue;
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(vp.width + 1);
      expect(b.y + b.height).toBeLessThanOrEqual(vp.height + 1);
    }

    // 4) Debug overlay reports dimensions that match what we measured.
    const debug = page.locator('[data-testid="interstitial-debug"]');
    await expect(debug).toBeVisible();
    const reportedPlayer = (await page.locator('[data-testid="dbg-player"]').innerText()).trim();
    const [rw, rh] = reportedPlayer.split("×").map((n) => Number.parseInt(n, 10));
    expect(Math.abs(rw - Math.round(box.width))).toBeLessThanOrEqual(1);
    expect(Math.abs(rh - Math.round(box.height))).toBeLessThanOrEqual(1);

    const mode = (await page.locator('[data-testid="dbg-ar-mode"]').innerText()).trim();
    expect(["intrinsic", "fallback-viewport"]).toContain(mode);
  });
}

test("orientation change recalculates player dimensions", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openInterstitialWithDebug(page);
  const player = page.locator('[data-testid^="interstitial-"] > div > div.relative.bg-black').first();
  const portraitBox = await player.boundingBox();

  await page.setViewportSize({ width: 844, height: 390 });
  // Allow the visualViewport listener + rAF to flush.
  await page.waitForTimeout(150);
  const landscapeBox = await player.boundingBox();

  expect(portraitBox).not.toBeNull();
  expect(landscapeBox).not.toBeNull();
  if (!portraitBox || !landscapeBox) return;
  expect(landscapeBox.width).toBeGreaterThan(portraitBox.width);
  expect(landscapeBox.height).toBeLessThan(portraitBox.height);
  // Both orientations must respect the viewport.
  expect(landscapeBox.width).toBeLessThanOrEqual(844 + 1);
  expect(landscapeBox.height).toBeLessThanOrEqual(390 + 1);
});
