import { test, expect, type Route } from "@playwright/test";
import { hasCredentials, signInAs } from "./helpers";

/**
 * Auth-failure variants for the stats endpoints.
 *
 * Simulates the two real auth-failure paths a user can hit on the admin
 * dashboards:
 *
 *   - Missing Authorization header   → server returns 401 Unauthorized
 *   - Malformed / tampered token     → server returns 401 invalid_jwt
 *   - Valid token, role revoked       → server returns 403 Forbidden
 *
 * We do not really revoke tokens at the network edge — instead we
 * intercept the server-fn POST and either strip the Authorization
 * header (then let it pass through) or fulfill directly with the
 * relevant status. In both cases the page must render the same red
 * `*-error-state` banner (NOT the neutral `*-empty-state`).
 */

const fulfill = (status: number, body: unknown) => (route: Route) =>
  route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });

const stripAuth = async (route: Route) => {
  const headers = { ...route.request().headers() };
  delete headers["authorization"];
  delete headers["Authorization"];
  // No real upstream will accept this, so synthesize the 401 the server
  // middleware would have returned.
  await route.fulfill({
    status: 401,
    contentType: "application/json",
    body: JSON.stringify({ error: "Unauthorized: No authorization header provided" }),
  });
};

const malformAuth = async (route: Route) => {
  await route.fulfill({
    status: 401,
    contentType: "application/json",
    body: JSON.stringify({ error: "invalid_jwt: malformed token" }),
  });
};

const SCENARIOS = [
  { name: "missing token (401)", handler: stripAuth, expectedTestIdHint: "error" },
  { name: "malformed token (401)", handler: malformAuth, expectedTestIdHint: "error" },
  {
    name: "revoked role (403)",
    handler: fulfill(403, { error: "Forbidden: admin role required" }),
    expectedTestIdHint: "error",
  },
] as const;

test.describe("Admin dashboards — auth-token failure banners", () => {
  test.skip(!hasCredentials, "No E2E credentials configured");

  for (const s of SCENARIOS) {
    test(`/admin/shorteners shows shortener-error-state on ${s.name}`, async ({ page }) => {
      await signInAs(page);
      await page.route(/\/_serverFn\/.*getShortenerReport/i, s.handler);
      await page.route(/shortener-admin\.functions/i, s.handler);

      await page.goto("/admin/shorteners");
      await page.waitForLoadState("networkidle");

      const err = page.getByTestId("shortener-error-state");
      await expect(err).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId("shortener-empty-state")).toHaveCount(0);
    });

    test(`/admin/episode-audit shows episode-audit-error-state on ${s.name}`, async ({ page }) => {
      await signInAs(page);
      await page.route(
        /\/_serverFn\/.*(getEpisodeAuditStats|listUnassignedEpisodes)/i,
        s.handler,
      );
      await page.route(/episode-audit\.functions/i, s.handler);

      await page.goto("/admin/episode-audit");
      await page.waitForLoadState("networkidle");

      const err = page.getByTestId("episode-audit-error-state");
      await expect(err).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId("episode-audit-empty-state")).toHaveCount(0);
    });
  }
});
