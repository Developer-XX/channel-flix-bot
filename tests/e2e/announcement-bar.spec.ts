import { test, expect } from "@playwright/test";

/**
 * Verifies the active announcement bar renders at the top of the homepage.
 * Intercepts the announcements server-function response so the test does not
 * depend on production data state, then asserts the bar is in the DOM, visible,
 * positioned near the top of the page, and contains the announcement text.
 */
test.describe("Active announcement bar", () => {
  const now = Date.now();
  const active = {
    id: "test-active",
    message: "🎉 Test announcement: site-wide update is live",
    level: "info",
    href: null,
    is_active: true,
    starts_at: new Date(now - 60_000).toISOString(),
    ends_at: new Date(now + 60 * 60_000).toISOString(),
  };

  test.beforeEach(async ({ page }) => {
    // Intercept any TanStack server-fn endpoint that serves announcements and
    // return the active row. We match permissively to survive minor route
    // refactors (the function name is the stable contract).
    await page.route(/_serverFn|serverFn|announcements/i, async (route) => {
      const url = route.request().url();
      if (/announcement/i.test(url)) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ result: { data: [active] }, data: [active] }),
        });
        return;
      }
      await route.continue();
    });
  });

  test("renders at top of homepage when active and in window", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const bar = page
      .locator('[data-testid="announcement-bar"], [role="status"]:has-text("Test announcement")')
      .first();

    // Fallback: any element containing the message text.
    const messageLocator = bar.or(page.getByText(active.message, { exact: false }).first());

    await expect(messageLocator).toBeVisible({ timeout: 10_000 });

    const box = await messageLocator.boundingBox();
    expect(box, "announcement bar must have a layout box").not.toBeNull();
    // Bar should render in the top region of the viewport (above the fold).
    expect(box!.y).toBeLessThan(200);
  });
});
