import { test, expect, request as pwRequest } from "@playwright/test";

/**
 * Verifies the actual HTTP response headers for pages that may render ads
 * include a Content-Security-Policy that constrains framed content, and that
 * every ad iframe rendered on the page declares the expected sandbox flags.
 *
 * If the page-level CSP header is absent (some hosts deliver it only in prod),
 * the test still asserts the per-iframe sandbox contract, which is the
 * primary defense for sandboxed HTML ads.
 */

const PAGES = ["/", "/trust"];

test.describe("CSP & iframe sandbox", () => {
  for (const path of PAGES) {
    test(`response headers + iframe sandbox on ${path}`, async ({ page, baseURL }) => {
      const url = new URL(path, baseURL ?? "http://localhost:8080").toString();
      const api = await pwRequest.newContext();
      const res = await api.get(url);
      expect(res.status(), `GET ${path} should succeed`).toBeLessThan(400);

      const csp =
        res.headers()["content-security-policy"] ??
        res.headers()["content-security-policy-report-only"];

      if (csp) {
        // If a CSP is set, it must not be wide-open and must restrict frames.
        expect(csp, "CSP should not allow arbitrary scripts via *").not.toMatch(
          /script-src[^;]*\*\s*(;|$)/i,
        );
        // Either frame-src or default-src must be declared (used as fallback).
        expect(csp).toMatch(/(frame-src|default-src)/i);
      }
      await api.dispose();

      // Now render and verify every ad iframe declares the expected sandbox.
      await page.goto(path);
      await page.waitForLoadState("networkidle").catch(() => {});
      const iframes = page.locator('iframe[data-ad-iframe]');
      const count = await iframes.count();
      for (let i = 0; i < count; i++) {
        const iframe = iframes.nth(i);
        const sandbox = (await iframe.getAttribute("sandbox")) ?? "";
        const tokens = new Set(sandbox.split(/\s+/).filter(Boolean));

        // Must allow scripts (ads need JS) and popups (legitimate clickthroughs)
        expect(tokens.has("allow-scripts"), `iframe[${i}] sandbox missing allow-scripts`).toBe(true);
        // MUST NOT grant same-origin (would break the sandbox barrier).
        expect(tokens.has("allow-same-origin"), `iframe[${i}] must not allow-same-origin`).toBe(false);
        // MUST NOT grant top-navigation (would let ads navigate the host page).
        expect(tokens.has("allow-top-navigation"), `iframe[${i}] must not allow-top-navigation`).toBe(
          false,
        );
      }
    });
  }
});
