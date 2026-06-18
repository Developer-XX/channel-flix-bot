import { test, expect } from "@playwright/test";
import { hasCredentials, signInAs } from "./helpers";

/**
 * Premium users must never see ad iframes / ad media on the homepage, on title
 * pages, or near the DownloadButton — across mobile, tablet, and desktop.
 *
 * The test relies on `data-testid="ad-slot-<placement>"` markers around each
 * AdSlot. When the current user is premium, AdSlot returns null, so the slot
 * marker should not be present in the DOM, and no `<iframe>` should appear
 * inside an `[data-ad-slot]` container.
 */

const BREAKPOINTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 900 },
] as const;

test.describe("Premium user: no ads", () => {
  test.skip(!hasCredentials, "Set TEST_USER/TEST_PASS or pre-mint a Supabase session to run.");

  test.beforeEach(async ({ page }) => {
    await signInAs(page);
  });

  for (const bp of BREAKPOINTS) {
    test.describe(`@${bp.name}`, () => {
      test.use({ viewport: { width: bp.width, height: bp.height } });

      test(`homepage shows no ad iframes — ${bp.name}`, async ({ page }) => {
        await page.goto("/");
        await page.waitForLoadState("networkidle").catch(() => {});
        await assertNoAds(page);
      });

      test(`title page shows no ad iframes — ${bp.name}`, async ({ page }) => {
        await page.goto("/");
        await page.waitForLoadState("domcontentloaded");
        const firstCard = page.locator('a[href^="/title/"]').first();
        if (!(await firstCard.count())) {
          test.skip(true, "No title cards available to navigate to");
          return;
        }
        await firstCard.click();
        await page.waitForLoadState("networkidle").catch(() => {});
        await assertNoAds(page);

        // DownloadButton vicinity should also be ad-free.
        const beforeDownload = page.getByTestId("ad-slot-before_download");
        await expect(beforeDownload).toHaveCount(0);
      });
    });
  }
});

async function assertNoAds(page: import("@playwright/test").Page) {
  // No AdSlot wrappers should be in the DOM for premium users.
  await expect(page.locator('[data-ad-slot]')).toHaveCount(0);
  await expect(page.locator('[data-testid^="ad-slot-"]')).toHaveCount(0);
  // Defense-in-depth: no iframes from ad sandboxes either.
  await expect(page.locator('iframe[data-ad-iframe]')).toHaveCount(0);
}
