import { test, expect } from "./fixtures";
import { hasCredentials, signInAs } from "./helpers";
import AxeBuilder from "@axe-core/playwright";

/**
 * Accessibility sweep for the View-all pages and DownloadButton screens.
 *
 * Uses @axe-core/playwright to assert no serious/critical landmark, focus,
 * or ARIA violations. Additionally checks the focus order tab cycle for the
 * DownloadButton screen and verifies premium users have no ad iframes that
 * are still reachable via Tab.
 */
const SECTION_PAGES = ["/section/trending", "/section/latest"];

test.describe("a11y — View all pages", () => {
  for (const path of SECTION_PAGES) {
    test(`${path} has no critical/serious a11y violations`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle").catch(() => {});
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "best-practice"])
        .analyze();
      const blocking = results.violations.filter((v) =>
        ["serious", "critical"].includes(v.impact ?? ""),
      );
      expect(blocking, formatViolations(blocking)).toEqual([]);

      // Landmark sanity: exactly one <main>.
      const mains = await page.locator("main").count();
      expect(mains).toBe(1);
    });
  }
});

test.describe("a11y — DownloadButton screen", () => {
  test("title page is a11y-clean and Download is keyboard-reachable", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle").catch(() => {});
    const firstCard = page.locator('a[href^="/title/"]').first();
    test.skip(!(await firstCard.count()), "No titles to navigate to");
    await firstCard.click();
    await page.waitForLoadState("networkidle").catch(() => {});

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    const blocking = results.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact ?? ""),
    );
    expect(blocking, formatViolations(blocking)).toEqual([]);

    // Tab until we land on a "Download" control or run out of tab stops.
    const download = page.getByRole("button", { name: /download/i }).first();
    if (await download.count()) {
      for (let i = 0; i < 60; i++) {
        await page.keyboard.press("Tab");
        const focusedText = await page.evaluate(() =>
          (document.activeElement as HTMLElement | null)?.innerText ?? "",
        );
        if (/download/i.test(focusedText)) return;
      }
      throw new Error("Download button never received keyboard focus within 60 Tab presses");
    }
  });
});

test.describe("a11y — premium ad iframe leakage", () => {
  test.skip(!hasCredentials, "Premium check requires a signed-in account");
  test("no ad iframe is focusable for premium users", async ({ page }) => {
    await signInAs(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle").catch(() => {});
    const focusable = await page.locator("iframe[data-ad-iframe]").evaluateAll((nodes) =>
      nodes
        .filter((n) => {
          const el = n as HTMLIFrameElement;
          const tabindex = Number(el.getAttribute("tabindex") ?? "0");
          return tabindex >= 0 && !el.closest('[aria-hidden="true"], [inert]');
        })
        .map((el) => (el as HTMLIFrameElement).title || "ad"),
    );
    expect(focusable, `leaked focusable ad iframes: ${focusable.join(", ")}`).toEqual([]);
  });
});

function formatViolations(v: { id: string; description: string; nodes: unknown[] }[]) {
  if (!v.length) return "no violations";
  return v.map((x) => `${x.id}: ${x.description} (${x.nodes.length} nodes)`).join("\n");
}
