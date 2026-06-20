import { test, expect, type Route } from "@playwright/test";
import { hasCredentials, signInAs } from "./helpers";

/**
 * Forced-failure tests for the two admin dashboards.
 *
 * Both pages call TanStack Start server functions (HTTP POST to
 * `/_serverFn/...`). We intercept those calls and respond with HTTP 500
 * so the query throws, which must render the red
 * `*-error-state` banner — NOT the neutral `*-empty-state` banner.
 *
 * Guards the user-visible distinction between "no data" and "backend
 * query failed" introduced after the `checked_at` regression.
 */

const failRoute = (status = 500) => (route: Route) =>
  route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify({ error: "e2e: forced failure" }),
  });

test.describe("Admin dashboards — forced backend failure", () => {
  test.skip(!hasCredentials, "No E2E credentials configured");

  test("/admin/shorteners shows shortener-error-state when stats query fails", async ({ page }) => {
    await signInAs(page);

    // Intercept the server-fn that powers the report. TanStack Start
    // dispatches server functions via `/_serverFn/...` (any path under
    // that prefix is the RPC bundle entry point).
    await page.route(/\/_serverFn\/.*getShortenerReport/i, failRoute(500));
    // Belt-and-suspenders: many builds expose the fn by its file path.
    await page.route(/shortener-admin\.functions/i, failRoute(500));

    await page.goto("/admin/shorteners");
    await page.waitForLoadState("networkidle");

    const err = page.getByTestId("shortener-error-state");
    await expect(err).toBeVisible({ timeout: 10_000 });
    await expect(err).toContainText(/could not load shortener report/i);

    // The neutral empty-state must NOT render simultaneously.
    await expect(page.getByTestId("shortener-empty-state")).toHaveCount(0);
  });

  test("/admin/episode-audit shows episode-audit-error-state when stats query fails", async ({ page }) => {
    await signInAs(page);

    await page.route(/\/_serverFn\/.*(getEpisodeAuditStats|listUnassignedEpisodes)/i, failRoute(500));
    await page.route(/episode-audit\.functions/i, failRoute(500));

    await page.goto("/admin/episode-audit");
    await page.waitForLoadState("networkidle");

    const err = page.getByTestId("episode-audit-error-state");
    await expect(err).toBeVisible({ timeout: 10_000 });

    await expect(page.getByTestId("episode-audit-empty-state")).toHaveCount(0);
  });
});
