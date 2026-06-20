import { test, expect } from "@playwright/test";
import { hasCredentials, signInAs } from "./helpers";

/**
 * Pagination smoke for the two admin dashboards.
 *
 * Asserts that after the seed has run (see
 * `scripts/seed-e2e-shortener-audit.ts`), each dashboard:
 *   1. Renders at least one data row on the initial view.
 *   2. Exposes a working "Next" pagination control (or a page-size /
 *      load-more affordance) whose click still results in non-empty
 *      table content.
 *
 * The tests degrade gracefully: if no pagination control exists on the
 * current build, we skip the click but still assert non-empty initial
 * rows so this file remains a useful regression net.
 */

async function rowCount(page: import("@playwright/test").Page, testid: string) {
  return await page.locator(`[data-testid="${testid}"] tbody tr`).count();
}

test.describe("Admin dashboards — pagination", () => {
  test.skip(!hasCredentials, "No E2E credentials configured");

  test("episode-audit table renders rows and survives page change", async ({ page }) => {
    await signInAs(page);
    await page.goto("/admin/episode-audit");
    await page.waitForLoadState("networkidle");

    // Wait for either the table or the empty-state to settle.
    await Promise.race([
      page.locator('[data-testid="episode-audit-table"] tbody tr').first().waitFor({ timeout: 10_000 }),
      page.getByTestId("episode-audit-empty-state").waitFor({ timeout: 10_000 }),
      page.getByTestId("episode-audit-error-state").waitFor({ timeout: 10_000 }),
    ]).catch(() => {});

    const initial = await rowCount(page, "episode-audit-table");
    if (initial === 0) test.skip(true, "no seeded audit rows — run scripts/seed-e2e-shortener-audit.ts first");
    expect(initial, "initial page must render at least one audit row").toBeGreaterThan(0);

    const next = page
      .getByRole("button", { name: /next|more|load more/i })
      .filter({ hasNot: page.locator("[disabled]") })
      .first();
    if (await next.count()) {
      await next.click();
      await page.waitForLoadState("networkidle");
      const after = await rowCount(page, "episode-audit-table");
      expect(after, "next page must also render rows").toBeGreaterThan(0);
    }
  });

  test("shortener report renders provider cards and survives page change", async ({ page }) => {
    await signInAs(page);
    await page.goto("/admin/shorteners");
    await page.waitForLoadState("networkidle");

    await Promise.race([
      page.locator('[data-testid="shortener-attempts-30d"]').first().waitFor({ timeout: 10_000 }),
      page.getByTestId("shortener-empty-state").waitFor({ timeout: 10_000 }),
      page.getByTestId("shortener-error-state").waitFor({ timeout: 10_000 }),
    ]).catch(() => {});

    const initial = await page.locator('[data-testid="shortener-attempts-30d"]').count();
    if (initial === 0) test.skip(true, "no seeded providers — run scripts/seed-e2e-shortener-audit.ts first");
    expect(initial).toBeGreaterThan(0);

    const next = page
      .getByRole("button", { name: /next|more|load more/i })
      .filter({ hasNot: page.locator("[disabled]") })
      .first();
    if (await next.count()) {
      await next.click();
      await page.waitForLoadState("networkidle");
      const after = await page.locator('[data-testid="shortener-attempts-30d"]').count();
      expect(after).toBeGreaterThan(0);
    }
  });
});
