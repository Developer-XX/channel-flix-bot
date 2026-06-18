import { test, expect } from "@playwright/test";

// Visual + structural regression: header and ad slots must not overflow
// the viewport on mobile, tablet, or desktop widths.

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 800 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 900 },
];

for (const v of VIEWPORTS) {
  test(`layout: header + body fit ${v.name} (${v.width}px)`, async ({ page }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});

    const overflow = await page.evaluate(() => {
      const d = document.documentElement;
      return { scrollW: d.scrollWidth, clientW: d.clientWidth };
    });
    expect(overflow.scrollW, `${v.name} doc width`).toBeLessThanOrEqual(overflow.clientW + 1);

    const header = page.locator("header").first();
    await expect(header).toBeVisible();
    const box = await header.boundingBox();
    expect(box?.width ?? 0).toBeLessThanOrEqual(v.width + 1);

    const media = await page
      .locator("main iframe, main img, main video")
      .all();
    for (const a of media) {
      const b = await a.boundingBox();
      if (b) expect(b.width).toBeLessThanOrEqual(v.width + 1);
    }
  });
}
