import { test, expect, type ConsoleMessage, type Page } from "@playwright/test";

// Smoke: no runtime errors on key public pages, and ad slot containers
// either render or are correctly suppressed without breaking layout.

const PUBLIC_ROUTES = ["/", "/trust"];

function attachErrorCollector(page: Page): { errors: string[] } {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  return { errors };
}

for (const route of PUBLIC_ROUTES) {
  test(`smoke: ${route} renders without runtime errors`, async ({ page }) => {
    const { errors } = attachErrorCollector(page);
    const res = await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(res?.ok(), `status for ${route}`).toBeTruthy();
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    const appErrors = errors.filter(
      (e) => !/favicon|DevTools|Failed to load resource|net::ERR_/i.test(e),
    );
    expect(appErrors, `errors on ${route}: ${appErrors.join("\n")}`).toEqual([]);
  });
}

test("homepage: any iframe ad has hardened sandbox + CSP", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  const iframes = await page.locator("iframe[srcdoc]").all();
  for (const f of iframes) {
    const sandbox = (await f.getAttribute("sandbox")) ?? "";
    expect(sandbox).toContain("allow-scripts");
    expect(sandbox).not.toContain("allow-same-origin");
    expect(sandbox).not.toContain("allow-top-navigation");
    const srcdoc = (await f.getAttribute("srcdoc")) ?? "";
    if (srcdoc) {
      expect(srcdoc).toContain("Content-Security-Policy");
      expect(srcdoc).toContain("frame-ancestors 'none'");
      expect(srcdoc).toContain("form-action 'none'");
    }
  }
});
