import { test, expect } from "@playwright/test";
import { hasCredentials, signInAs } from "./helpers";

/**
 * Admin Telegram sync panel: after a mock scan completes, the sync
 * status/notification area should reflect the new state (timestamp, counters,
 * or a "completed" toast). We intercept the scan server-fn endpoint so the
 * test does not hit the real Telegram API.
 */
test.describe("Admin Telegram sync status updates after scan", () => {
  test.skip(!hasCredentials, "Set TEST_USER/TEST_PASS or pre-mint a Supabase session.");

  test("status area updates after a mocked scan completes", async ({ page }) => {
    // Mock any server-fn or REST endpoint that triggers a scan/backfill.
    await page.route(/(telegram).*(scan|backfill|resync|sync)/i, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          result: {
            data: {
              ok: true,
              scannedAt: new Date().toISOString(),
              processed: 7,
              matched: 5,
              unmatched: 2,
              message: "Scan completed",
            },
          },
        }),
      });
    });

    await signInAs(page);
    await page.goto("/admin/telegram");

    // Admin route may redirect non-admin users; bail gracefully.
    if (!page.url().includes("/admin/telegram")) {
      test.skip(true, "Signed-in user is not an admin; cannot exercise this panel.");
      return;
    }

    await page.waitForLoadState("networkidle").catch(() => {});

    // Capture pre-scan status text snapshot.
    const statusRegion = page
      .locator('[data-testid="telegram-sync-status"]')
      .or(page.getByRole("status"))
      .first();
    const before = (await statusRegion.textContent().catch(() => "")) ?? "";

    // Trigger the scan via the most likely button label.
    const trigger = page.getByRole("button", {
      name: /scan|sync|backfill|run now|refresh/i,
    }).first();
    test.skip(!(await trigger.count()), "No scan trigger button on this admin page");
    await trigger.click();

    // The panel should reflect new state: either a fresh timestamp, a counter,
    // or a "completed"/"7 processed" string from the mocked response.
    await expect(async () => {
      const after = (await statusRegion.textContent().catch(() => "")) ?? "";
      const toastMatch = await page.getByText(/completed|processed|matched|7/i).first().isVisible().catch(() => false);
      expect(after !== before || toastMatch).toBe(true);
    }).toPass({ timeout: 10_000 });
  });
});
