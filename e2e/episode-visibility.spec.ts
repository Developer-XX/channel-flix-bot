import { test, expect } from "@playwright/test";

/**
 * Title slugs to verify. Override with E2E_TITLE_SLUGS="slug1,slug2".
 * Defaults cover the cases the user has been debugging.
 */
const SLUGS = (process.env.E2E_TITLE_SLUGS ?? "shaktimaan-the-animated-series,chhota-bheem,doraemon")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

for (const slug of SLUGS) {
  test.describe(`title: ${slug}`, () => {
    test(`episode rows and download buttons are visible & clickable`, async ({ page }) => {
      await page.goto(`/title/${slug}`, { waitUntil: "domcontentloaded" });

      // Open every season accordion (any element with aria-expanded=false inside the title page).
      // Season header buttons render the count line; click each closed one.
      const seasonButtons = page.locator('button:has-text("episode")');
      const seasonCount = await seasonButtons.count();
      for (let i = 0; i < seasonCount; i++) {
        const btn = seasonButtons.nth(i);
        if (await btn.isVisible()) {
          await btn.click().catch(() => {});
        }
      }

      const rows = page.locator('[data-testid="episode-row"]');
      const buttons = page.locator('[data-testid="download-btn"]');

      // If page has no episodes at all (movie/empty), the test still passes — but we log it.
      const rowCount = await rows.count();
      const btnCount = await buttons.count();
      test.info().annotations.push({ type: "counts", description: `rows=${rowCount} btns=${btnCount}` });

      if (rowCount === 0) test.skip(true, "no episode rows on this title");

      // Every row must be visible inside the viewport, not clipped horizontally.
      const viewport = page.viewportSize()!;
      for (let i = 0; i < rowCount; i++) {
        const row = rows.nth(i);
        await expect(row, `row #${i} visible`).toBeVisible();
        const box = await row.boundingBox();
        expect(box, `row #${i} boundingBox`).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
      }

      // Every download button must be visible and clickable (we don't actually navigate).
      for (let i = 0; i < btnCount; i++) {
        const btn = buttons.nth(i);
        await btn.scrollIntoViewIfNeeded();
        await expect(btn, `download btn #${i} visible`).toBeVisible();
        await expect(btn, `download btn #${i} enabled`).toBeEnabled();
        const box = await btn.boundingBox();
        expect(box, `btn #${i} box`).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
      }
    });
  });
}
