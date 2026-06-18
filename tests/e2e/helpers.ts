import { test, expect, type Page } from "@playwright/test";

/**
 * Helpers shared by the E2E specs. Authentication uses TEST_USER / TEST_PASS
 * environment variables (set by Lovable for the configured test account) or
 * the LOVABLE_BROWSER_SUPABASE_SESSION_JSON pre-minted session if present.
 */

export const TEST_EMAIL = process.env.TEST_USER ?? process.env.E2E_TEST_USER;
export const TEST_PASS = process.env.TEST_PASS ?? process.env.E2E_TEST_PASS;
export const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;
export const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;

export const hasCredentials = Boolean((TEST_EMAIL && TEST_PASS) || (STORAGE_KEY && SESSION_JSON));

export async function signInAs(page: Page) {
  // Pre-minted session takes priority (no UI interaction needed).
  if (STORAGE_KEY && SESSION_JSON) {
    await page.goto("/");
    await page.evaluate(
      ({ key, value }) => window.localStorage.setItem(key, value),
      { key: STORAGE_KEY, value: SESSION_JSON },
    );
    await page.reload();
    return;
  }

  if (!TEST_EMAIL || !TEST_PASS) {
    throw new Error("E2E credentials not configured");
  }

  await page.goto("/auth");
  await page.getByLabel(/email/i).fill(TEST_EMAIL);
  await page.getByLabel(/password/i).fill(TEST_PASS);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 15_000 });
}

export async function signOut(page: Page) {
  await page.evaluate(async () => {
    // Clear any supabase tokens
    Object.keys(window.localStorage)
      .filter((k) => k.startsWith("sb-") || k.includes("supabase"))
      .forEach((k) => window.localStorage.removeItem(k));
  });
}
