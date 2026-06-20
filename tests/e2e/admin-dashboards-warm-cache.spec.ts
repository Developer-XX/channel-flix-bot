import { test, expect } from "@playwright/test";
import { hasCredentials, signInAs } from "./helpers";

/**
 * Warm-cache regression for the stats pages.
 *
 * Loads each admin dashboard twice in the same browser context:
 *   1) Cold — first load after sign-in, server-fn + DB query are cold.
 *   2) Warm — react-query cache + any server-side cache should make the
 *      repeat noticeably faster.
 *
 * We assert:
 *   - The page still renders the headline UI on the warm load.
 *   - The warm wall-clock is < cold (with a 10% slack for noise).
 */

const PAGES = [
  {
    path: "/admin/shorteners",
    readyTestId: "shortener-table",
    fallbackHeading: /shortener/i,
  },
  {
    path: "/admin/episode-audit",
    readyTestId: "episode-audit-table",
    fallbackHeading: /episode audit/i,
  },
] as const;

test.describe("Admin dashboards — warm cache", () => {
  test.skip(!hasCredentials, "No E2E credentials configured");

  for (const p of PAGES) {
    test(`${p.path} renders on warm load and is faster than cold`, async ({ page }) => {
      await signInAs(page);

      const measure = async () => {
        const start = Date.now();
        await page.goto(p.path);
        await page.waitForLoadState("networkidle");
        // Prefer the testid; fall back to a heading match so a UI tweak
        // doesn't silently turn this into a no-op.
        const target = page.getByTestId(p.readyTestId);
        if (await target.count()) {
          await expect(target.first()).toBeVisible({ timeout: 15_000 });
        } else {
          await expect(page.getByRole("heading", { name: p.fallbackHeading })).toBeVisible({
            timeout: 15_000,
          });
        }
        return Date.now() - start;
      };

      const cold = await measure();
      // Force a fresh navigation without dropping auth state.
      await page.goto("about:blank");
      const warm = await measure();

      // Warm must still render the same UI.
      // Warm should be at least marginally faster; allow 10% slack.
      expect(warm, `warm=${warm}ms cold=${cold}ms`).toBeLessThan(cold * 1.1);
    });
  }
});
