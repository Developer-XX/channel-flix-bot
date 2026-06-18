import { test, expect } from "@playwright/test";

/**
 * Clicks every "View all" button on the homepage, asserts the resulting page
 * is a /section/* (or /browse/*) route, that at least one title card or an
 * empty-state message renders, and that no console errors fired during navigation.
 */
test.describe("Homepage View all buttons", () => {
  test("each row's View all navigates to a working section page", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(`console: ${msg.text()}`);
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle").catch(() => {});

    const buttons = page.getByRole("link", { name: /view all/i });
    const count = await buttons.count();
    test.skip(count === 0, "No rows rendered on homepage to test View all from");

    // Collect hrefs first (DOM may re-render between navigations).
    const hrefs: string[] = [];
    for (let i = 0; i < count; i++) {
      const href = await buttons.nth(i).getAttribute("href");
      if (href) hrefs.push(href);
    }

    for (const href of hrefs) {
      await page.goto(href);
      await page.waitForLoadState("domcontentloaded");
      expect(page.url()).toMatch(/\/(section|browse)\//);

      // Page renders title-grid or an explicit empty-state message.
      const cards = page.locator('a[href^="/title/"]');
      const empty = page.getByText(/no titles|nothing here|not found/i);
      await expect(cards.first().or(empty.first())).toBeVisible({ timeout: 10_000 });
    }

    expect(consoleErrors, `console errors during navigation: ${consoleErrors.join(" | ")}`)
      .toEqual([]);
  });
});
