import { test, expect, type Page } from "@playwright/test";

/**
 * Ensures the title page renders every key region without elements collapsing
 * off-screen at common mobile/tablet/desktop widths.
 *
 * Provide TITLE_SLUGS=slug1,slug2 to test specific titles, or the spec falls
 * back to a small built-in list.
 */
const SLUGS = (process.env.TITLE_SLUGS ?? "chhota-bheem-2008").split(",").map((s) => s.trim()).filter(Boolean);
const VIEWPORTS = [
  { name: "xs", width: 320, height: 640 },
  { name: "sm", width: 360, height: 740 },
  { name: "iphone", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
] as const;

async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    return document.documentElement.scrollWidth - document.documentElement.clientWidth;
  });
  expect(overflow, "page has horizontal overflow").toBeLessThanOrEqual(2);
}

async function assertInViewport(page: Page, locator: ReturnType<Page["locator"]>) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, "element has no bounding box").not.toBeNull();
  const vw = page.viewportSize()!.width;
  expect(box!.x, "element off-screen left").toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width, "element off-screen right").toBeLessThanOrEqual(vw + 1);
}

for (const slug of SLUGS) {
  test.describe(`title page /title/${slug}`, () => {
    for (const vp of VIEWPORTS) {
      test(`${vp.name} (${vp.width}x${vp.height}) — key regions visible, no overflow`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(`/title/${slug}`);
        await page.waitForLoadState("networkidle");

        // H1 + poster region must be visible
        const h1 = page.locator("h1").first();
        await assertInViewport(page, h1);

        // Downloads / Seasons heading must be visible
        await assertInViewport(page, page.getByRole("heading", { name: /downloads/i }).first());

        // Either a season accordion (series) or at least one episode/download row
        const accordion = page.getByTestId("season-accordion");
        const episodeRow = page.getByTestId("episode-row").first();
        const hasAccordion = await accordion.count();
        const hasEpisode = await episodeRow.count();
        expect(hasAccordion + hasEpisode, "no episode UI rendered").toBeGreaterThan(0);

        if (hasAccordion) {
          await assertInViewport(page, accordion);
        }

        // Footer must reachable
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(150);

        // No horizontal overflow at any viewport
        await assertNoHorizontalOverflow(page);
      });
    }
  });
}
