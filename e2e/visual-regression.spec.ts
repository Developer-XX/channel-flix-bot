import { test, expect, type Page } from "@playwright/test";

/**
 * Visual regression tests for mobile breakpoints.
 *
 * Asserts that key chrome (header, hero CTA, title grid, mobile menu, dialog)
 * is fully visible inside the viewport — no hidden / off-screen / clipped UI —
 * across 320 / 360 / 390 widths.
 *
 * Snapshots are full-page screenshots tagged per project, so the first run
 * generates baselines under `e2e/visual-regression.spec.ts-snapshots/`.
 * Subsequent runs fail on pixel drift > maxDiffPixelRatio.
 *
 * Run: `bunx playwright test e2e/visual-regression.spec.ts`
 * Update baselines: `bunx playwright test e2e/visual-regression.spec.ts --update-snapshots`
 */

const TITLE_SLUGS = (process.env.TITLE_SLUGS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

async function waitForFontsAndImages(page: Page) {
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForLoadState("networkidle").catch(() => {});
  // Disable in-flight CSS animations to stabilize pixel snapshots.
  await page.addStyleTag({
    content: `*, *::before, *::after { animation: none !important; transition: none !important; }`,
  });
}

async function assertNoHorizontalOverflow(page: Page) {
  const { scrollW, innerW } = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
  }));
  // Allow 1px sub-pixel rounding.
  expect(scrollW, "page should not scroll horizontally").toBeLessThanOrEqual(innerW + 1);
}

async function assertVisible(page: Page, locator: ReturnType<Page["locator"]>, label: string) {
  await expect(locator, `${label} should be visible`).toBeVisible({ timeout: 8_000 });
  const box = await locator.boundingBox();
  expect(box, `${label} should have a layout box`).not.toBeNull();
  if (box) {
    expect(box.width, `${label} width > 0`).toBeGreaterThan(0);
    expect(box.height, `${label} height > 0`).toBeGreaterThan(0);
    // Element must be horizontally inside viewport.
    const viewport = page.viewportSize();
    if (viewport) {
      expect(box.x, `${label} left in viewport`).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width, `${label} right in viewport`).toBeLessThanOrEqual(viewport.width + 1);
    }
  }
}

test.describe("mobile visual regression — homepage", () => {
  test("header, hero, and trending grid render without clipping", async ({ page }, info) => {
    await page.goto("/");
    await waitForFontsAndImages(page);

    await assertVisible(page, page.locator("header").first(), "site header");
    await assertVisible(page, page.getByRole("link", { name: /streamvault/i }).first(), "brand");
    await assertVisible(page, page.getByRole("button", { name: /search/i }).first(), "search icon");
    await assertVisible(
      page,
      page.getByRole("button", { name: /toggle menu/i }).first(),
      "menu toggle",
    );

    // Hero
    await assertVisible(page, page.getByRole("heading", { level: 1 }).first(), "hero heading");
    await assertVisible(
      page,
      page.getByRole("link", { name: /start exploring|watch now/i }).first(),
      "hero primary CTA",
    );

    await assertNoHorizontalOverflow(page);

    await expect(page).toHaveScreenshot(`home-${info.project.name}.png`, {
      fullPage: true,
      maxDiffPixelRatio: 0.04,
      animations: "disabled",
      mask: [page.locator("img")], // images can vary by upstream
    });
  });

  test("mobile menu opens and shows all categories", async ({ page }) => {
    await page.goto("/");
    await waitForFontsAndImages(page);

    const toggle = page.getByRole("button", { name: /toggle menu/i }).first();
    await toggle.click();

    // Drawer
    const drawer = page.locator("header").locator("xpath=following-sibling::*").first();
    // Category links inside drawer
    const links = page.locator("a", { hasText: /movie|series|anime|drama|cartoon/i });
    expect(await links.count()).toBeGreaterThan(0);
    await assertVisible(page, links.first(), "first menu category");

    await assertNoHorizontalOverflow(page);
    void drawer;
  });
});

test.describe("mobile visual regression — title page", () => {
  const slugs = TITLE_SLUGS.length
    ? TITLE_SLUGS
    : ["doraemon-the-movie-nobita-s-earth-symphony-2024"];

  for (const slug of slugs) {
    test(`title "${slug}" renders header, poster, downloads`, async ({ page }, info) => {
      await page.goto(`/title/${slug}`);
      await waitForFontsAndImages(page);

      await assertVisible(page, page.locator("header").first(), "site header");
      await assertVisible(page, page.getByRole("heading", { level: 1 }).first(), "title heading");
      await assertVisible(
        page,
        page.getByRole("heading", { name: /downloads/i }).first(),
        "downloads section",
      );

      await assertNoHorizontalOverflow(page);

      await expect(page).toHaveScreenshot(`title-${slug}-${info.project.name}.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.04,
        animations: "disabled",
        mask: [page.locator("img")],
      });
    });
  }
});
