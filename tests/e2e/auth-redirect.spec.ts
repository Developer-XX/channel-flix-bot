import { test, expect } from "@playwright/test";
import { signOut } from "./helpers";

/**
 * Unauthenticated users clicking a protected route should land on /auth with
 * a `redirect` search param pointing back to the originally requested URL.
 */

test.describe("Post-login redirect-back", () => {
  test("Visiting /admin while signed out redirects to /auth?redirect=/admin", async ({ page }) => {
    await page.goto("/");
    await signOut(page);

    await page.goto("/admin");
    await page.waitForURL(/\/auth/, { timeout: 10_000 });

    const url = new URL(page.url());
    expect(url.pathname).toBe("/auth");
    const redirect = url.searchParams.get("redirect");
    expect(redirect, "redirect search param must round-trip the target URL").toBeTruthy();
    expect(redirect!.includes("/admin")).toBe(true);
  });

  test("Visiting /premium while signed out preserves /premium in redirect", async ({ page }) => {
    await page.goto("/");
    await signOut(page);

    await page.goto("/premium");
    await page.waitForURL(/\/auth/, { timeout: 10_000 });

    const redirect = new URL(page.url()).searchParams.get("redirect");
    expect(redirect).toBeTruthy();
    expect(redirect!.includes("/premium")).toBe(true);
  });

  test("Visiting /support while signed out preserves /support in redirect", async ({ page }) => {
    await page.goto("/");
    await signOut(page);

    await page.goto("/support");
    await page.waitForURL(/\/auth/, { timeout: 10_000 });

    const redirect = new URL(page.url()).searchParams.get("redirect");
    expect(redirect).toBeTruthy();
    expect(redirect!.includes("/support")).toBe(true);
  });
});
