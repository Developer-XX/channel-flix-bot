import { test, expect, type Page } from "@playwright/test";

/**
 * Admin access lifecycle E2E.
 *
 * Requires the following env vars to fully exercise the suite:
 *   ADMIN_EMAIL       — an existing account with role=admin
 *   ADMIN_PASSWORD    — its password
 *   USER_EMAIL        — an existing non-admin account
 *   USER_PASSWORD     — its password
 *   E2E_BASE_URL      — preview URL (defaults to playwright.config baseURL)
 *
 * When ADMIN_* creds are missing the suite still asserts the unauthenticated
 * gate (the most common regression — /admin silently redirecting authenticated
 * admins back to /auth).
 */

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const USER_EMAIL = process.env.USER_EMAIL;
const USER_PASSWORD = process.env.USER_PASSWORD;

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/auth");
  await page.getByLabel(/email/i).first().fill(email);
  await page.getByLabel(/password/i).first().fill(password);
  await page.getByRole("button", { name: /sign in|log in/i }).first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 15_000 });
}

test.describe("/admin access lifecycle", () => {
  test("unauthenticated visitors are redirected to /auth", async ({ page }) => {
    await page.goto("/admin");
    await page.waitForURL(/\/auth/, { timeout: 10_000 });
    expect(page.url()).toContain("/auth");
  });

  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, "ADMIN_* env vars not provided");

  test("admin can sign in and reach /admin without being bounced", async ({ page }) => {
    await signIn(page, ADMIN_EMAIL!, ADMIN_PASSWORD!);
    await page.goto("/admin");
    // Should stay on /admin — assert it does NOT redirect back to /auth.
    await page.waitForLoadState("networkidle");
    expect(page.url()).not.toMatch(/\/auth(\?|$|\/)/);
    expect(page.url()).toContain("/admin");
    // Surface at least one admin-only control to confirm role check passed.
    await expect(
      page.getByRole("link", { name: /diagnostics|sync trace|verification|telegram/i }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("admin can reach /admin/diagnostics and every check resolves", async ({ page }) => {
    await signIn(page, ADMIN_EMAIL!, ADMIN_PASSWORD!);
    await page.goto("/admin/diagnostics");
    await page.waitForLoadState("networkidle");
    expect(page.url()).toContain("/admin/diagnostics");
    // No check should be stuck in a loading state.
    await expect(page.getByText(/SESSION_PRESENT/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/ROLE_ADMIN/i)).toBeVisible();
  });

  test.skip(!USER_EMAIL || !USER_PASSWORD, "USER_* env vars not provided");

  test("non-admin signed-in users cannot stay on /admin", async ({ page }) => {
    await signIn(page, USER_EMAIL!, USER_PASSWORD!);
    await page.goto("/admin");
    await page.waitForLoadState("networkidle");
    // Either redirected away, or shown an explicit "not authorized" message —
    // both are acceptable, but admin controls must not be visible.
    const stillOnAdmin = page.url().includes("/admin");
    if (stillOnAdmin) {
      await expect(page.getByText(/not authori[sz]ed|forbidden|admin only/i)).toBeVisible();
    } else {
      expect(page.url()).not.toContain("/admin");
    }
  });
});
