import { test, expect, type Route } from "@playwright/test";
import { hasCredentials, signInAs } from "./helpers";

/**
 * HTTP-error variants of the forced-failure suite.
 *
 * The original admin-dashboards-failure.spec.ts asserts the red
 * `*-error-state` banner renders on a generic 500. Real-world failures
 * are usually more specific: 401 (session expired), 403 (role lost),
 * 504 (upstream timeout). All three must surface the same banner so the
 * operator sees "backend query failed" instead of a misleading empty
 * state.
 */

const fulfill = (status: number, body: unknown) => (route: Route) =>
  route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });

const SCENARIOS = [
  { status: 401, body: { error: "Unauthorized" } },
  { status: 403, body: { error: "Forbidden" } },
  { status: 504, body: { error: "Gateway Timeout" } },
] as const;

test.describe("Admin dashboards — HTTP error banners", () => {
  test.skip(!hasCredentials, "No E2E credentials configured");

  for (const s of SCENARIOS) {
    test(`/admin/shorteners renders shortener-error-state on ${s.status}`, async ({ page }) => {
      await signInAs(page);
      await page.route(/\/_serverFn\/.*getShortenerReport/i, fulfill(s.status, s.body));
      await page.route(/shortener-admin\.functions/i, fulfill(s.status, s.body));

      await page.goto("/admin/shorteners");
      await page.waitForLoadState("networkidle");

      const err = page.getByTestId("shortener-error-state");
      await expect(err).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId("shortener-empty-state")).toHaveCount(0);
    });

    test(`/admin/episode-audit renders episode-audit-error-state on ${s.status}`, async ({ page }) => {
      await signInAs(page);
      await page.route(
        /\/_serverFn\/.*(getEpisodeAuditStats|listUnassignedEpisodes)/i,
        fulfill(s.status, s.body),
      );
      await page.route(/episode-audit\.functions/i, fulfill(s.status, s.body));

      await page.goto("/admin/episode-audit");
      await page.waitForLoadState("networkidle");

      const err = page.getByTestId("episode-audit-error-state");
      await expect(err).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId("episode-audit-empty-state")).toHaveCount(0);
    });
  }
});
