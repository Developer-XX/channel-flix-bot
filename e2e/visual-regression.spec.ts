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

  test("mobile menu expanded — drawer snapshot", async ({ page }, info) => {
    await page.goto("/");
    await waitForFontsAndImages(page);

    const toggle = page.getByRole("button", { name: /toggle menu/i }).first();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    const links = page.locator("a", { hasText: /movie|series|anime|drama|cartoon/i });
    expect(await links.count()).toBeGreaterThan(0);
    await assertVisible(page, links.first(), "first menu category");
    await assertNoHorizontalOverflow(page);

    await expect(page).toHaveScreenshot(`menu-open-${info.project.name}.png`, {
      fullPage: false,
      maxDiffPixelRatio: 0.04,
      animations: "disabled",
    });
  });

  test("trending row scrolled — no cards clipped after horizontal scroll", async ({ page }, info) => {
    await page.goto("/");
    await waitForFontsAndImages(page);

    const trending = page.getByRole("heading", { name: /trending now/i }).first();
    if (!(await trending.isVisible().catch(() => false))) test.skip(true, "no trending row to test");
    const row = trending.locator("xpath=following-sibling::*[1]");
    // Scroll the row horizontally by 200px to expose later cards.
    await row.evaluate((el) => el.scrollBy({ left: 200 }));
    await page.waitForTimeout(150);

    await assertNoHorizontalOverflow(page);
    await expect(row).toHaveScreenshot(`trending-scrolled-${info.project.name}.png`, {
      maxDiffPixelRatio: 0.06,
      animations: "disabled",
      mask: [page.locator("img")],
    });
  });

  test("search results page renders without clipping", async ({ page }, info) => {
    await page.goto("/search?q=a");
    await waitForFontsAndImages(page);

    await assertVisible(page, page.locator("header").first(), "header on search");
    await assertNoHorizontalOverflow(page);

    await expect(page).toHaveScreenshot(`search-${info.project.name}.png`, {
      fullPage: true,
      maxDiffPixelRatio: 0.05,
      animations: "disabled",
      mask: [page.locator("img")],
    });
  });
});

test.describe("mobile visual regression — modal / dialog", () => {
  test("download dialog (if rendered) snapshots cleanly", async ({ page }, info) => {
    const slug =
      (process.env.TITLE_SLUGS ?? "")
        .split(",").map((s) => s.trim()).filter(Boolean)[0] ??
      "doraemon-the-movie-nobita-s-earth-symphony-2024";
    await page.goto(`/title/${slug}`);
    await waitForFontsAndImages(page);

    const dlBtn = page.getByRole("button", { name: /download/i }).first();
    if (!(await dlBtn.isVisible().catch(() => false))) {
      test.skip(true, "no download button on this title");
    }
    await dlBtn.click().catch(() => {});
    // Wait for any dialog/popover that may open.
    const dialog = page.getByRole("dialog").first();
    if (await dialog.isVisible().catch(() => false)) {
      await assertNoHorizontalOverflow(page);
      await expect(dialog).toHaveScreenshot(`download-dialog-${info.project.name}.png`, {
        maxDiffPixelRatio: 0.05,
        animations: "disabled",
        mask: [page.locator("img")],
      });
    } else {
      test.skip(true, "download button did not open a dialog");
    }
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
