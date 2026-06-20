import { test, expect } from "@playwright/test";

/**
 * Verifies the tutorial video section always renders BEFORE the
 * "Request a title" section on a title detail page, and that the
 * tutorial's CTA scrolls to the request anchor.
 *
 * Skipped automatically when no seeded title is available.
 */
test.describe("tutorial-to-request flow", () => {
  test("tutorial section precedes request-title section", async ({ page }) => {
    await page.goto("/");
    // Click the first title card we can find to get to a title page.
    const firstTitleLink = page.locator('a[href^="/title/"]').first();
    if ((await firstTitleLink.count()) === 0) {
      test.skip(true, "No titles seeded on homepage");
      return;
    }
    await firstTitleLink.click();
    await page.waitForURL(/\/title\//, { timeout: 15_000 });

    const request = page.getByTestId("request-title-section");
    await expect(request).toBeVisible({ timeout: 15_000 });

    const tutorial = page.getByTestId("tutorial-section");
    // Tutorial only renders when admin enabled it. If absent, skip ordering check.
    if ((await tutorial.count()) === 0) {
      test.skip(true, "Tutorial section disabled by admin");
      return;
    }
    await expect(tutorial).toBeVisible();

    // DOM order: tutorial must come before request.
    const order = await page.evaluate(() => {
      const t = document.querySelector('[data-testid="tutorial-section"]');
      const r = document.querySelector('[data-testid="request-title-section"]');
      if (!t || !r) return null;
      return t.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING ? "tutorial-first" : "request-first";
    });
    expect(order).toBe("tutorial-first");

    // CTA in tutorial scrolls to request anchor.
    await page.getByTestId("tutorial-cta-request").click();
    await page.waitForTimeout(600);
    const inView = await request.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= -10 && r.top < window.innerHeight;
    });
    expect(inView).toBe(true);
  });
});
