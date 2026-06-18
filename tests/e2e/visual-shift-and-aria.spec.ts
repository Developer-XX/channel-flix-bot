import { test, expect } from "@playwright/test";
import { hasCredentials, signInAs } from "./helpers";

/**
 * Visual regression with explicit, per-placement layout-shift thresholds.
 *
 * Each ad slot wrapper is captured at mobile / tablet / desktop. The threshold
 * is tuned per placement: tighter for fixed-height image/iframe wrappers,
 * looser for slots that can carry video and gain a few px of letterbox.
 */

const BREAKPOINTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 900 },
] as const;

/**
 * Per-slot tolerance:
 *  - maxDiffPixelRatio: fraction of pixels that may differ from baseline.
 *  - maxDiffPixels:     absolute cap for tiny screenshots so a single antialias
 *                       seam can't blow the ratio.
 */
const PLACEMENTS: Array<{
  key: string;
  route: string;
  maxDiffPixelRatio: number;
  maxDiffPixels: number;
}> = [
  { key: "homepage_banner",  route: "/", maxDiffPixelRatio: 0.015, maxDiffPixels: 250 },
  { key: "between_rows",     route: "/", maxDiffPixelRatio: 0.020, maxDiffPixels: 300 },
  { key: "title_page",       route: "/", maxDiffPixelRatio: 0.025, maxDiffPixels: 400 },
  { key: "before_download",  route: "/", maxDiffPixelRatio: 0.025, maxDiffPixels: 400 },
];

for (const bp of BREAKPOINTS) {
  test.describe(`@visual-shift ${bp.name}`, () => {
    test.use({ viewport: { width: bp.width, height: bp.height } });

    for (const p of PLACEMENTS) {
      test(`ad slot ${p.key} stays within shift threshold — ${bp.name}`, async ({ page }) => {
        await page.goto(p.route);
        await page.waitForLoadState("networkidle").catch(() => {});
        const slot = page.getByTestId(`ad-slot-${p.key}`).first();
        if (!(await slot.count())) {
          test.skip(true, `Placement ${p.key} not rendered on ${p.route}`);
          return;
        }
        await slot.scrollIntoViewIfNeeded();
        await page.waitForTimeout(250);

        // Capture and verify the slot wrapper's bounding box matches the
        // baseline-shaped expectation: width fills its container and height
        // is non-zero (no collapse).
        const box = await slot.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.height).toBeGreaterThan(20);
        expect(box!.width).toBeGreaterThan(100);

        await expect(slot).toHaveScreenshot(`shift-${p.key}-${bp.name}.png`, {
          animations: "disabled",
          maxDiffPixelRatio: p.maxDiffPixelRatio,
          maxDiffPixels: p.maxDiffPixels,
        });
      });
    }
  });
}

test.describe("Premium users have no hidden-but-focusable ad iframes", () => {
  test.skip(!hasCredentials, "Premium check needs a signed-in account.");

  test("no offscreen / aria-hidden ad iframe is reachable by tab", async ({ page }) => {
    await signInAs(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle").catch(() => {});

    // Any ad iframe that's tabbable is a leak.
    const focusableAdIframes = await page.locator("iframe[data-ad-iframe]").evaluateAll((nodes) =>
      nodes
        .filter((n) => {
          const el = n as HTMLIFrameElement;
          const tabindex = Number(el.getAttribute("tabindex") ?? "0");
          // Inert / aria-hidden ancestors disqualify a node from focus.
          const ariaHidden = el.closest('[aria-hidden="true"]');
          const inert = el.closest("[inert]");
          return !ariaHidden && !inert && tabindex >= 0;
        })
        .map((el) => (el as HTMLIFrameElement).title || "ad-iframe"),
    );

    expect(focusableAdIframes,
      `premium screen should have no focusable ad iframes: ${focusableAdIframes.join(", ")}`)
      .toEqual([]);
  });
});

test.describe("AdSlot ARIA contract", () => {
  test("every rendered ad slot exposes role + accessible label", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle").catch(() => {});
    const slots = page.locator("[data-ad-slot]");
    const n = await slots.count();
    test.skip(n === 0, "No ad slots rendered (user may be premium or no ads configured)");

    for (let i = 0; i < n; i++) {
      const slot = slots.nth(i);
      await expect(slot).toHaveAttribute("role", /complementary|region/);
      const label = await slot.getAttribute("aria-label");
      expect(label, `slot[${i}] aria-label`).toBeTruthy();

      // Any iframe inside an ad slot must be hardened.
      const iframe = slot.locator("iframe").first();
      if (await iframe.count()) {
        const sandbox = (await iframe.getAttribute("sandbox")) ?? "";
        expect(sandbox).toContain("allow-scripts");
        expect(sandbox).not.toContain("allow-same-origin");
      }
    }
  });
});
