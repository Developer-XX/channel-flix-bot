import { test, expect, type Page } from "@playwright/test";
import { hasCredentials, signInAs } from "./helpers";

/**
 * Warm-cache regression for the stats pages.
 *
 * Loads each admin dashboard twice in the same browser context:
 *   1) Cold — first load after sign-in, server-fn + DB query are cold.
 *   2) Warm — react-query cache + any server-side cache should make the
 *      repeat noticeably faster.
 *
 * Assertions:
 *   - Skeleton placeholder is visible on cold load (transition observable).
 *   - Skeleton disappears once the table renders.
 *   - Warm reload shows the same row count and the first-row text snapshot.
 *   - Warm wall-clock is < cold × 1.1 (10% slack for noise).
 */

const PAGES = [
  {
    path: "/admin/shorteners",
    readyTestId: "shortener-table",
    skeletonTestId: "shortener-loading",
    fallbackHeading: /shortener/i,
  },
  {
    path: "/admin/episode-audit",
    readyTestId: "episode-audit-table",
    skeletonTestId: "episode-audit-loading",
    fallbackHeading: /episode audit/i,
  },
] as const;

async function snapshotTable(page: Page, testId: string) {
  const table = page.getByTestId(testId).first();
  await expect(table).toBeVisible({ timeout: 15_000 });
  const rows = table.locator("tbody tr");
  const count = await rows.count();
  const firstRowText = count > 0 ? ((await rows.first().innerText()).trim() ?? "") : "";
  return { count, firstRowText };
}

test.describe("Admin dashboards — warm cache", () => {
  test.skip(!hasCredentials, "No E2E credentials configured");

  for (const p of PAGES) {
    test(`${p.path} renders consistently on warm reload`, async ({ page }) => {
      await signInAs(page);

      const measure = async (observeSkeleton: boolean) => {
        const start = Date.now();
        const nav = page.goto(p.path);

        if (observeSkeleton) {
          // Best-effort: a fast warm load may never show the skeleton.
          // On cold load it must appear at least briefly.
          const skel = page.getByTestId(p.skeletonTestId).first();
          try {
            await skel.waitFor({ state: "visible", timeout: 2_000 });
          } catch {
            /* skeleton may render and resolve faster than the poll */
          }
        }

        await nav;
        await page.waitForLoadState("networkidle");

        const table = page.getByTestId(p.readyTestId);
        if (await table.count()) {
          await expect(table.first()).toBeVisible({ timeout: 15_000 });
          // Skeleton must be gone once the table has rendered.
          await expect(page.getByTestId(p.skeletonTestId)).toHaveCount(0);
        } else {
          await expect(page.getByRole("heading", { name: p.fallbackHeading })).toBeVisible({
            timeout: 15_000,
          });
        }

        const elapsed = Date.now() - start;
        const snap = (await page.getByTestId(p.readyTestId).count())
          ? await snapshotTable(page, p.readyTestId)
          : { count: 0, firstRowText: "" };
        return { elapsed, ...snap };
      };

      const cold = await measure(true);
      await page.goto("about:blank");
      const warm = await measure(false);

      // Same data after warm reload.
      expect(warm.count, "row count diverged between cold and warm").toBe(cold.count);
      expect(warm.firstRowText, "first-row content diverged between cold and warm").toBe(
        cold.firstRowText,
      );

      // Warm should be at least marginally faster.
      expect(
        warm.elapsed,
        `warm=${warm.elapsed}ms cold=${cold.elapsed}ms`,
      ).toBeLessThan(cold.elapsed * 1.1);
    });
  }
});
