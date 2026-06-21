import { test, expect, type Page } from "@playwright/test";

/**
 * E2E: Backup & Restore page.
 *
 * Verifies:
 *  - The /admin/backup route is registered and renders (not 404).
 *  - The health check passes and shows the healthy banner.
 *  - The export button produces a valid JSON archive with expected keys.
 *  - A dry-run import of the just-exported archive returns integrity:compatible.
 *
 * Requires:
 *   ADMIN_EMAIL, ADMIN_PASSWORD — an admin account.
 *   E2E_BASE_URL                — preview URL (else uses playwright config).
 */

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/auth");
  await page.getByLabel(/email/i).first().fill(email);
  await page.getByLabel(/password/i).first().fill(password);
  await page.getByRole("button", { name: /sign in|log in/i }).first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 15_000 });
}

test.describe("/admin/backup", () => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, "ADMIN_* env vars not provided");

  test("route renders, health passes, export → dry-run import round-trip works", async ({ page }) => {
    await signIn(page, ADMIN_EMAIL!, ADMIN_PASSWORD!);
    await page.goto("/admin/backup");

    // Page rendered (not the not-found page).
    await expect(page.getByRole("heading", { name: /backup\s*&\s*restore/i })).toBeVisible({ timeout: 20_000 });

    // Health banner visible.
    await expect(page.getByText(/endpoint healthy/i)).toBeVisible({ timeout: 15_000 });

    // Trigger export and capture the download.
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 60_000 }),
      page.getByRole("button", { name: /download backup/i }).click(),
    ]);
    const path = await download.path();
    expect(path).toBeTruthy();

    // Read archive, validate shape.
    const fs = await import("node:fs/promises");
    const archive = JSON.parse(await fs.readFile(path!, "utf8"));
    expect(archive.version).toBe(1);
    expect(archive.schema_version).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(archive.schema_tables)).toBe(true);
    expect(typeof archive.tables).toBe("object");

    // Upload it back for a dry-run.
    await page.setInputFiles('input[type="file"]', path!);
    await page.getByRole("button", { name: /dry-run/i }).click();

    await expect(page.getByText(/integrity:\s*compatible/i)).toBeVisible({ timeout: 60_000 });
  });

  test("shows troubleshooting card when endpoint is unreachable", async ({ page, context }) => {
    await signIn(page, ADMIN_EMAIL!, ADMIN_PASSWORD!);
    // Force health endpoint to fail.
    await context.route("**/_serverFn/**checkBackupHealth**", (route) =>
      route.fulfill({ status: 503, body: "Service Unavailable" }),
    );
    await page.goto("/admin/backup");
    await expect(page.getByText(/backup\s*&\s*restore is unavailable/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/troubleshooting/i)).toBeVisible();
  });
});
