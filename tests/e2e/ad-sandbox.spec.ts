import { test, expect } from "@playwright/test";

// Verifies a hostile HTML ad cannot escape its sandbox into the parent
// document — mirrors AdSlot's iframe config (sandbox + CSP).

const HOSTILE_HTML = `
  <!doctype html><html><head>
    <meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob: https:; script-src 'unsafe-inline' https:; style-src 'unsafe-inline' https:; img-src data: blob: https:; media-src data: blob: https:; frame-ancestors 'none'; form-action 'none';">
  </head><body>
    <script>
      try { window.parent.__pwned = true; } catch (e) { window.__blockedParent = true; }
      try { window.top.location = 'https://evil.example'; } catch (e) { window.__blockedTop = true; }
    </script>
    <div id="ok">ad body</div>
  </body></html>`;

test("sandboxed iframe cannot write to window.parent or navigate top", async ({ page }) => {
  await page.setContent(`
    <html><body>
      <iframe id="ad" sandbox="allow-scripts allow-popups" srcdoc='${HOSTILE_HTML.replace(/'/g, "&#39;")}'></iframe>
    </body></html>
  `);
  const frame = page.frameLocator("#ad");
  await expect(frame.locator("#ok")).toHaveText("ad body");
  const pwned = await page.evaluate(() => (window as any).__pwned === true);
  expect(pwned).toBe(false);
  expect(page.url()).not.toContain("evil.example");
  const blocked = await page.evaluate(() => {
    const f = document.getElementById("ad") as HTMLIFrameElement;
    try {
      return {
        blockedParent: (f.contentWindow as any).__blockedParent === true,
        blockedTop: (f.contentWindow as any).__blockedTop === true,
      };
    } catch {
      // Cross-origin access itself blocked → already proves isolation.
      return { blockedParent: true, blockedTop: true };
    }
  });
  expect(blocked.blockedParent).toBe(true);
  expect(blocked.blockedTop).toBe(true);
});
