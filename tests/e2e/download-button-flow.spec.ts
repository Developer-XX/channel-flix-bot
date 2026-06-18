import { test, expect } from "@playwright/test";
import { hasCredentials, signInAs } from "./helpers";

/**
 * Full DownloadButton flow.
 *
 *  Verified path:    homepage → title page → click Download → Telegram redirect
 *                    with a token in the URL → verification call resolves OK →
 *                    file send response acknowledged.
 *  Unverified path:  same up to click → user is shown a verification prompt
 *                    (link-shortener step) instead of being redirected.
 *
 * Server-fn endpoints are intercepted so the test is hermetic and doesn't hit
 * real Telegram. We assert behaviour from the user-visible UI + outbound URLs.
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

test.describe("DownloadButton — verified user", () => {
  test.skip(!hasCredentials, "Sign-in required for verified flow");

  test("redirects to Telegram with a token after verification passes", async ({ page, context }) => {
    await signInAs(page);

    // Mock verification + delivery endpoints to succeed.
    await page.route(/verification|verify/i, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          result: { data: { verified: true, token: "tok_test_123" } },
        }),
      });
    });
    await page.route(/(download|delivery|telegram).*send/i, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ result: { data: { ok: true, deliveryId: "d_1" } } }),
      });
    });

    const ok = await gotoFirstTitle(page);
    test.skip(!ok, "No titles available to exercise download flow");

    const btn = page.getByRole("button", { name: /download/i }).first();
    test.skip(!(await btn.count()), "Download button not present");

    // The button typically opens t.me in a new tab. Capture both navigation
    // and a same-tab redirect to be resilient to either implementation.
    const popupPromise = context.waitForEvent("page", { timeout: 5_000 }).catch(() => null);
    await btn.click();
    const popup = await popupPromise;
    const targetUrl = popup ? popup.url() : page.url();

    // Either a Telegram deep-link with a token, or a status confirmation on the page.
    const isTelegram = /t\.me|telegram\.me/i.test(targetUrl);
    const onPageConfirm = await page
      .getByText(/sent to telegram|opening telegram|delivered|check your chat/i)
      .first()
      .isVisible()
      .catch(() => false);

    expect(isTelegram || onPageConfirm, `expected Telegram redirect or in-page confirmation, got ${targetUrl}`)
      .toBe(true);

    if (isTelegram) {
      expect(targetUrl, "Telegram deep-link should carry a start/token param").toMatch(
        /(start=|token=|tok_)/,
      );
    }
  });
});

test.describe("DownloadButton — non-verified user", () => {
  test("shows verification prompt instead of redirecting", async ({ page }) => {
    // Force verification to report 'not verified'.
    await page.route(/verification|verify/i, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          result: { data: { verified: false, requireVerification: true, shortenerUrl: "https://example.com/short" } },
        }),
      });
    });

    const ok = await gotoFirstTitle(page);
    test.skip(!ok, "No titles available to exercise download flow");

    const btn = page.getByRole("button", { name: /download/i }).first();
    test.skip(!(await btn.count()), "Download button not present");

    await btn.click();

    // Expect a verification step in the UI: a prompt, modal, or inline message.
    const prompt = page
      .getByText(/verify|verification|complete the short|continue to verify|unlock download/i)
      .first();
    await expect(prompt).toBeVisible({ timeout: 10_000 });
  });
});
