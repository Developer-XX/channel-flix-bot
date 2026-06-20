import { test, expect } from "@playwright/test";
import { hasCredentials, signInAs } from "./helpers";

/**
 * Smoke tests for the two admin dashboards that recently broke:
 *
 *  - /admin/episode-audit had been showing "Not Found" because the route
 *    tree was stale.
 *  - /admin/shorteners showed all "—" and 0s because the stats query used
 *    `created_at` instead of `checked_at`.
 *
 * These tests guard against both regressions: the routes must render their
 * own headers (not the root NotFoundComponent), and when sample data exists
 * the cards/table rows must actually appear.
 */

test.describe("Admin dashboards render with real content", () => {
  test.skip(!hasCredentials, "No E2E credentials configured");

  test("/admin/episode-audit does NOT show Not Found", async ({ page }) => {
    await signInAs(page);
    await page.goto("/admin/episode-audit");
    await page.waitForLoadState("networkidle");

    // The route's own H1 must render — proves the child route matched.
    await expect(
      page.getByRole("heading", { level: 1, name: /episode audit/i }),
    ).toBeVisible();

    // The root notFoundComponent renders the literal "Not Found". If that
    // text shows up inside the admin <Outlet />, the route is missing.
    const body = await page.locator("main").innerText();
    expect(body).not.toMatch(/^\s*Not Found\s*$/i);

    // The per-channel health table header must render even with zero rows.
    await expect(
      page.getByRole("heading", { name: /per-channel health/i }),
    ).toBeVisible();
  });

  test("/admin/shorteners renders provider cards", async ({ page }) => {
    await signInAs(page);
    await page.goto("/admin/shorteners");
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByRole("heading", { level: 1, name: /shortener performance/i }),
    ).toBeVisible();

    // Provider cards render labeled stats. When configs exist, at least one
    // "Attempts 30d" label is present.
    const attemptsLabel = page.getByText(/attempts 30d/i).first();
    await attemptsLabel.waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});

    // If sample data exists in shortener_health_log, at least one provider
    // card should show a non-zero attempts count. We only assert non-empty
    // when the empty-state banner is absent.
    const emptyBanner = page.getByTestId("shortener-empty-state");
    const hasEmptyState = await emptyBanner.isVisible().catch(() => false);
    if (!hasEmptyState) {
      const attemptValues = await page
        .locator('[data-testid="shortener-attempts-30d"]')
        .allInnerTexts();
      const total = attemptValues.reduce((acc, v) => acc + Number(v || 0), 0);
      expect(
        total,
        "expected at least one shortener attempt when sample data exists",
      ).toBeGreaterThan(0);
    }
  });
});
