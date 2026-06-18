import { test, expect } from "@playwright/test";

/**
 * Visual regression for the site header and each AdSlot placement across
 * mobile / tablet / desktop. Baselines live alongside this spec under
 * __screenshots__/ and are updated with `playwright test --update-snapshots`.
 *
 * A small diff threshold absorbs antialiasing noise; meaningful layout shifts
 * (wrap/overflow/stacking changes) exceed it and fail the run.
 */

const BREAKPOINTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 900 },
] as const;

const PLACEMENTS: Array<{ key: string; route: string; testId: string }> = [
  { key: "homepage_banner", route: "/", testId: "ad-slot-homepage_banner" },
  { key: "between_rows", route: "/", testId: "ad-slot-between_rows" },
  { key: "title_page", route: "/", testId: "ad-slot-title_page" },
  { key: "before_download", route: "/", testId: "ad-slot-before_download" },
];

for (const bp of BREAKPOINTS) {
  test.describe(`@visual ${bp.name}`, () => {
    test.use({ viewport: { width: bp.width, height: bp.height } });

    test(`header layout — ${bp.name}`, async ({ page }) => {
      await page.goto("/");
      await page.waitForLoadState("networkidle").catch(() => {});
      const header = page.locator("header").first();
      await expect(header).toBeVisible();
      // Stabilise dynamic content (avatars / timers) by waiting one frame.
      await page.waitForTimeout(150);
      await expect(header).toHaveScreenshot(`header-${bp.name}.png`, {
        maxDiffPixelRatio: 0.02,
        animations: "disabled",
      });
    });

    for (const p of PLACEMENTS) {
      test(`ad placement ${p.key} — ${bp.name}`, async ({ page }) => {
        await page.goto(p.route);
        await page.waitForLoadState("networkidle").catch(() => {});
        const slot = page.getByTestId(p.testId).first();
        if (!(await slot.count())) {
          test.skip(true, `Placement ${p.key} not rendered on this route`);
          return;
        }
        await slot.scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
        await expect(slot).toHaveScreenshot(`ad-${p.key}-${bp.name}.png`, {
          maxDiffPixelRatio: 0.03,
          animations: "disabled",
        });
      });
    }
  });
}
