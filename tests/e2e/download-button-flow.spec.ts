import { test, expect } from "./fixtures";
import { hasCredentials, signInAs } from "./helpers";

/**
 * DownloadButton flow tests powered by shared mocks in fixtures.ts.
 *
 * `mockTelegram` short-circuits t.me/telegram.me navigations and records the
 * last URL, `mockVerification` toggles between verified/unverified, and
 * `mockFileSend` records every delivery payload.
 */

async function gotoFirstTitle(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle").catch(() => {});
  const card = page.locator('a[href^="/title/"]').first();
  if (!(await card.count())) return false;
  await card.click();
  await page.waitForLoadState("networkidle").catch(() => {});
  return true;
}

test.describe("DownloadButton — verified", () => {
  test.skip(!hasCredentials, "Sign-in required");

  test("redirects to Telegram and dispatches a file-send call", async ({
    page, mockTelegram, mockVerification, mockFileSend,
  }) => {
    await signInAs(page);
    mockVerification.setVerified(true);

    const ok = await gotoFirstTitle(page);
    test.skip(!ok, "No titles");

    const btn = page.getByRole("button", { name: /download/i }).first();
    test.skip(!(await btn.count()), "No download button");

    await btn.click();
    // Give async send + redirect a beat.
    await page.waitForTimeout(800);

    const telegramUrl = mockTelegram.lastRedirectUrl();
    const sends = mockFileSend.payloads();
    const onPageConfirm = await page
      .getByText(/sent to telegram|opening telegram|delivered|check your chat/i)
      .first().isVisible().catch(() => false);

    expect(
      Boolean(telegramUrl) || sends.length > 0 || onPageConfirm,
      `expected Telegram redirect, file-send call, or in-page confirmation`
    ).toBe(true);

    expect(mockVerification.calls(), "verification must run before delivery").toBeGreaterThan(0);

    if (telegramUrl) {
      expect(telegramUrl).toMatch(/(start=|token=|tok_)/);
    }
  });
});

test.describe("DownloadButton — non-verified", () => {
  test("shows verification prompt and does not call file-send", async ({
    page, mockVerification, mockFileSend,
  }) => {
    mockVerification.setVerified(false);
    mockVerification.setShortenerUrl("https://example.com/short");

    const ok = await gotoFirstTitle(page);
    test.skip(!ok, "No titles");

    const btn = page.getByRole("button", { name: /download/i }).first();
    test.skip(!(await btn.count()), "No download button");

    await btn.click();

    const prompt = page.getByText(
      /verify|verification|complete the short|continue to verify|unlock download/i,
    ).first();
    await expect(prompt).toBeVisible({ timeout: 10_000 });

    // No delivery should fire when the user is not yet verified.
    expect(mockFileSend.payloads(), "file send must not run before verification").toEqual([]);
  });
});
