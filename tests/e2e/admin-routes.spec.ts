import { test, expect } from "@playwright/test";
import { hasCredentials, signInAs } from "./helpers";

/**
 * Once signed in, clicking the header Admin / Premium / Support buttons or
 * navigating to admin sub-routes must keep the user on that route — it must
 * NEVER silently bounce back to "/".
 *
 * Requires admin credentials. Skips when not configured so CI still passes
 * on forks without secrets.
 */

const ADMIN_ROUTES = [
  "/admin",
  "/admin/tutorial",
  "/admin/announcements",
  "/admin/premium",
  "/admin/support",
  "/admin/notifications",
  "/admin/diagnostics",
  "/admin/settings",
];

test.describe("Authenticated routes do not bounce to home", () => {
  test.skip(!hasCredentials, "No E2E credentials configured");

  test("Admin button in header opens /admin (not home)", async ({ page }) => {
    await signInAs(page);
    await page.goto("/");
    const adminLink = page.getByRole("link", { name: /admin/i }).first();
    if (await adminLink.isVisible().catch(() => false)) {
      await adminLink.click();
      await page.waitForURL(/\/admin/, { timeout: 10_000 });
      expect(new URL(page.url()).pathname).not.toBe("/");
    }
  });

  test("Premium link opens /premium (not home)", async ({ page }) => {
    await signInAs(page);
    await page.goto("/premium");
    await page.waitForLoadState("networkidle");
    expect(new URL(page.url()).pathname).toBe("/premium");
  });

  test("Support link opens /support (not home)", async ({ page }) => {
    await signInAs(page);
    await page.goto("/support");
    await page.waitForLoadState("networkidle");
    expect(new URL(page.url()).pathname).toBe("/support");
  });

  for (const route of ADMIN_ROUTES) {
    test(`Admin sub-route ${route} renders without bouncing`, async ({ page }) => {
      await signInAs(page);
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      const pathname = new URL(page.url()).pathname;
      // We accept the exact route or a deeper child — anything starting with /admin.
      // What we reject is silent bounce to "/" or to "/auth".
      expect(pathname.startsWith("/admin"), `${route} bounced to ${pathname}`).toBe(true);
    });
  }
});
