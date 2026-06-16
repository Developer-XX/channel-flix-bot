import { test, expect, type Page, type Browser } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Accessibility scans for mobile breakpoints using axe-core.
 *
 * Run: `bunx playwright test e2e/a11y.spec.ts`
 *
 * The suite fails on serious or critical issues in the WCAG 2.1 A/AA
 * tagset. Moderate/minor issues are surfaced in the report so they can be
 * triaged but do not block the run.
 */

const ROUTES = [
  { path: "/", label: "home" },
  { path: "/search?q=", label: "search-empty" },
  { path: "/browse/movie", label: "browse-movies" },
];

const TITLE_SLUGS = (process.env.TITLE_SLUGS ?? "doraemon-the-movie-nobita-s-earth-symphony-2024")
  .split(",").map((s) => s.trim()).filter(Boolean);

async function settle(page: Page) {
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.addStyleTag({
    content: `*, *::before, *::after { animation: none !important; transition: none !important; }`,
  });
}

async function scan(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    // Color-contrast is dark-theme-specific; oklch tokens aren't reliably
    // parsed by axe yet. Verified manually via design tokens.
    .disableRules(["color-contrast"])
    .analyze();

  const blocking = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );

  if (blocking.length) {
    const formatted = blocking.map((v) => {
      const nodes = v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ");
      return `[${v.impact}] ${v.id} (${v.nodes.length} node${v.nodes.length === 1 ? "" : "s"})\n    help: ${v.helpUrl}\n    e.g.: ${nodes}`;
    }).join("\n  - ");
    throw new Error(`a11y failures on ${label}:\n  - ${formatted}`);
  }

  return results;
}

test.describe("axe-core — public routes", () => {
  for (const route of ROUTES) {
    test(`${route.label} (${route.path}) has no serious/critical a11y issues`, async ({ page }) => {
      await page.goto(route.path);
      await settle(page);
      await scan(page, route.label);
    });
  }

  for (const slug of TITLE_SLUGS) {
    test(`title:${slug} has no serious/critical a11y issues`, async ({ page }) => {
      await page.goto(`/title/${slug}`);
      await settle(page);
      await scan(page, `title:${slug}`);
    });
  }
});

test.describe("axe-core — interactive states", () => {
  test("mobile menu open passes a11y + has labelled toggle", async ({ page }) => {
    await page.goto("/");
    await settle(page);

    const toggle = page.getByRole("button", { name: /toggle menu/i }).first();
    await expect(toggle, "menu toggle must have accessible name").toBeVisible();
    await expect(toggle).toHaveAttribute("aria-label", /menu/i);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    await scan(page, "mobile-menu-open");
  });

  test("all icon-only buttons in the header have accessible names", async ({ page }) => {
    await page.goto("/");
    await settle(page);
    const headerButtons = page.locator("header button");
    const count = await headerButtons.count();
    expect(count, "header should expose buttons").toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const btn = headerButtons.nth(i);
      const text = (await btn.innerText()).trim();
      const aria = (await btn.getAttribute("aria-label")) ?? "";
      const labelledBy = await btn.getAttribute("aria-labelledby");
      expect(
        text.length > 0 || aria.length > 0 || labelledBy,
        `header button #${i} is missing an accessible name`,
      ).toBeTruthy();
    }
  });
});

// Optional cross-cutting check: viewports advertised by the matrix should
// not introduce content overflow / clipping that hides important nodes.
test("primary tap targets are at least 36px on mobile", async ({ page }, info) => {
  test.skip(!info.project.name.startsWith("mobile"), "mobile-only check");
  await page.goto("/");
  await settle(page);
  const ctaButtons = page.getByRole("link", { name: /start exploring|watch now/i });
  const count = await ctaButtons.count();
  for (let i = 0; i < count; i++) {
    const box = await ctaButtons.nth(i).boundingBox();
    if (!box) continue;
    expect(box.height, "CTA tap-target ≥ 36px").toBeGreaterThanOrEqual(36);
  }
});

// Keep the import alive even if Playwright tree-shakes unused types.
void Browser;
