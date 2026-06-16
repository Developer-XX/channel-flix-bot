import { test, expect, type Page } from "@playwright/test";

/**
 * Visual regression tests for mobile breakpoints.
 *
 * Asserts that key chrome (header, hero CTA, title grid, mobile menu, dialog)
 * is fully visible inside the viewport — no hidden / off-screen / clipped UI —
 * across 320 / 360 / 390 widths.
 *
 * Snapshots are full-page screenshots tagged per project, so the first run
 * generates baselines under `e2e/visual-regression.spec.ts-snapshots/`.
 * Subsequent runs fail on pixel drift > maxDiffPixelRatio.
 *
 * Run: `bunx playwright test e2e/visual-regression.spec.ts`
 * Update baselines: `bunx playwright test e2e/visual-regression.spec.ts --update-snapshots`
 */

const TITLE_SLUGS = (process.env.TITLE_SLUGS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Force reduced-motion + a frozen clock for every visual test to keep
// animations, randomized greetings, and time-based UI deterministic.
test.use({
  colorScheme: "dark",
  reducedMotion: "reduce",
});

test.beforeEach(async ({ page }) => {
  // Stub analytics + tracking BEFORE any navigation so they never affect timing.
  await page.route(
    /(google-analytics|googletagmanager|hotjar|segment|fullstory|plausible|posthog|sentry\.io|datadog|amplitude)/i,
    (r) => r.fulfill({ status: 204, body: "" }).catch(() => {}),
  );
  // Stub the in-house web-vitals beacon so RUM POSTs don't keep the network busy.
  await page.route(/\/_serverFn\/.*web[-_]?vitals/i, (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: "{}" }).catch(() => {}),
  );

  // Track in-flight API calls so tests can wait for "API settled" instead of networkidle.
  const inflight = new Set<string>();
  (page as Page & { __inflight?: Set<string> }).__inflight = inflight;
  const isApi = (url: string) =>
    /\/(rest|auth|storage|functions)\/v\d+\//.test(url) || /\/_serverFn\//.test(url);
  page.on("request", (r) => {
    if (isApi(r.url())) inflight.add(r.url() + "#" + Math.random());
  });
  const drop = () => {
    // Coarse but effective: requestfinished/failed don't expose the same key, so we
    // pop oldest. Tests only care about the count reaching 0.
    const first = inflight.values().next().value;
    if (first) inflight.delete(first);
  };
  page.on("requestfinished", (r) => isApi(r.url()) && drop());
  page.on("requestfailed", (r) => isApi(r.url()) && drop());

  await page.addInitScript(() => {
    // Freeze clock to a deterministic instant.
    const FROZEN = new Date("2026-06-16T12:00:00Z").valueOf();
    const RealDate = Date;
    // @ts-expect-error override
    globalThis.Date = class extends RealDate {
      constructor(...args: ConstructorParameters<typeof Date>) {
        super(...(args.length ? args : [FROZEN]));
      }
      static now() {
        return FROZEN;
      }
    };
    let seed = 1;
    Math.random = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    // Neutralize in-app analytics no-ops.
    (window as unknown as { gtag?: () => void; dataLayer?: unknown[] }).gtag = () => {};
    (window as unknown as { dataLayer: unknown[] }).dataLayer = [];
  });
});

/**
 * Deterministic rendering harness — reduces flakiness on mobile breakpoints by:
 *  - Stubbed analytics + tracked in-flight API requests (see beforeEach)
 *  - Waits for app API responses (Supabase REST + server fns) to drain, not
 *    generic networkidle (which third-party CDNs can stall indefinitely)
 *  - Awaits document.fonts.ready + two RAF ticks
 *  - Disables animations, transitions, caret blink, scrollbars, video
 *  - Waits for every <img> to finish decoding so layout-shift is settled
 */
async function waitForFontsAndImages(page: Page) {
  // 1. Drain in-flight app API requests (Supabase REST / server fns), bounded.
  const inflight = (page as Page & { __inflight?: Set<string> }).__inflight;
  if (inflight) {
    const start = Date.now();
    while (inflight.size > 0 && Date.now() - start < 4_000) {
      await page.waitForTimeout(50);
    }
  }
  // 2. Fonts.
  await page.evaluate(async () => {
    try {
      await (document as Document & { fonts?: FontFaceSet }).fonts?.ready;
    } catch {}
  });
  // 3. Two RAF ticks for webfont swap / layout settle.
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
  // 4. Disable animations / transitions / caret blink / scrollbars / video.
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
        caret-color: transparent !important;
      }
      html { scrollbar-gutter: stable; }
      ::-webkit-scrollbar { display: none !important; }
      video, [data-testid="video"] { visibility: hidden !important; }
    `,
  });
  // 5. Wait for every <img> to decode.
  await page.evaluate(async () => {
    const imgs = Array.from(document.images);
    await Promise.all(
      imgs.map((img) =>
        img.complete && img.naturalWidth > 0
          ? Promise.resolve()
          : new Promise<void>((r) => {
              img.addEventListener("load", () => r(), { once: true });
              img.addEventListener("error", () => r(), { once: true });
            }),
      ),
    );
  });
}

/**
 * Wait for the next Supabase REST response matching `tablePattern` after an
 * action that triggers a fetch (e.g. typing into search). Returns the
 * response so callers can assert status if needed.
 */
async function waitForApiResponse(page: Page, tablePattern: RegExp, timeout = 5_000) {
  return page
    .waitForResponse(
      (resp) => tablePattern.test(resp.url()) && resp.request().method() !== "OPTIONS",
      { timeout },
    )
    .catch(() => null);
}

async function assertNoHorizontalOverflow(page: Page) {
  const { scrollW, innerW } = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
  }));
  // Allow 1px sub-pixel rounding.
  expect(scrollW, "page should not scroll horizontally").toBeLessThanOrEqual(innerW + 1);
}

async function assertVisible(page: Page, locator: ReturnType<Page["locator"]>, label: string) {
  await expect(locator, `${label} should be visible`).toBeVisible({ timeout: 8_000 });
  const box = await locator.boundingBox();
  expect(box, `${label} should have a layout box`).not.toBeNull();
  if (box) {
    expect(box.width, `${label} width > 0`).toBeGreaterThan(0);
    expect(box.height, `${label} height > 0`).toBeGreaterThan(0);
    // Element must be horizontally inside viewport.
    const viewport = page.viewportSize();
    if (viewport) {
      expect(box.x, `${label} left in viewport`).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width, `${label} right in viewport`).toBeLessThanOrEqual(viewport.width + 1);
    }
  }
}

test.describe("mobile visual regression — homepage", () => {
  test("header, hero, and trending grid render without clipping", async ({ page }, info) => {
    await page.goto("/");
    await waitForFontsAndImages(page);

    await assertVisible(page, page.locator("header").first(), "site header");
    await assertVisible(page, page.getByRole("link", { name: /streamvault/i }).first(), "brand");
    await assertVisible(page, page.getByRole("button", { name: /search/i }).first(), "search icon");
    await assertVisible(
      page,
      page.getByRole("button", { name: /toggle menu/i }).first(),
      "menu toggle",
    );

    // Hero
    await assertVisible(page, page.getByRole("heading", { level: 1 }).first(), "hero heading");
    await assertVisible(
      page,
      page.getByRole("link", { name: /start exploring|watch now/i }).first(),
      "hero primary CTA",
    );

    await assertNoHorizontalOverflow(page);

    await expect(page).toHaveScreenshot(`home-${info.project.name}.png`, {
      fullPage: true,
      maxDiffPixelRatio: 0.04,
      animations: "disabled",
      mask: [page.locator("img")], // images can vary by upstream
    });
  });

  test("mobile menu expanded — drawer snapshot", async ({ page }, info) => {
    await page.goto("/");
    await waitForFontsAndImages(page);

    const toggle = page.getByRole("button", { name: /toggle menu/i }).first();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    const links = page.locator("a", { hasText: /movie|series|anime|drama|cartoon/i });
    expect(await links.count()).toBeGreaterThan(0);
    await assertVisible(page, links.first(), "first menu category");
    await assertNoHorizontalOverflow(page);

    await expect(page).toHaveScreenshot(`menu-open-${info.project.name}.png`, {
      fullPage: false,
      maxDiffPixelRatio: 0.04,
      animations: "disabled",
    });
  });

  test("trending row scrolled — no cards clipped after horizontal scroll", async ({ page }, info) => {
    await page.goto("/");
    await waitForFontsAndImages(page);

    const trending = page.getByRole("heading", { name: /trending now/i }).first();
    if (!(await trending.isVisible().catch(() => false))) test.skip(true, "no trending row to test");
    const row = trending.locator("xpath=following-sibling::*[1]");
    // Scroll the row horizontally by 200px to expose later cards.
    await row.evaluate((el) => el.scrollBy({ left: 200 }));
    await page.waitForTimeout(150);

    await assertNoHorizontalOverflow(page);
    await expect(row).toHaveScreenshot(`trending-scrolled-${info.project.name}.png`, {
      maxDiffPixelRatio: 0.06,
      animations: "disabled",
      mask: [page.locator("img")],
    });
  });

  test("search results page renders without clipping", async ({ page }, info) => {
    // Wait for the actual master_titles search response, not just networkidle.
    const apiPromise = waitForApiResponse(page, /master_titles.*ilike|imdb_id=eq/i);
    await page.goto("/search?q=a");
    await apiPromise;
    await waitForFontsAndImages(page);

    await assertVisible(page, page.locator("header").first(), "header on search");
    await assertNoHorizontalOverflow(page);

    await expect(page).toHaveScreenshot(`search-${info.project.name}.png`, {
      fullPage: true,
      maxDiffPixelRatio: 0.05,
      animations: "disabled",
      mask: [page.locator("img")],
    });
  });
});

test.describe("mobile visual regression — modal / dialog", () => {
  test("download dialog (if rendered) snapshots cleanly", async ({ page }, info) => {
    const slug =
      (process.env.TITLE_SLUGS ?? "")
        .split(",").map((s) => s.trim()).filter(Boolean)[0] ??
      "doraemon-the-movie-nobita-s-earth-symphony-2024";
    await page.goto(`/title/${slug}`);
    await waitForFontsAndImages(page);

    const dlBtn = page.getByRole("button", { name: /download/i }).first();
    if (!(await dlBtn.isVisible().catch(() => false))) {
      test.skip(true, "no download button on this title");
    }
    await dlBtn.click().catch(() => {});
    // Wait for any dialog/popover that may open.
    const dialog = page.getByRole("dialog").first();
    if (await dialog.isVisible().catch(() => false)) {
      await assertNoHorizontalOverflow(page);
      await expect(dialog).toHaveScreenshot(`download-dialog-${info.project.name}.png`, {
        maxDiffPixelRatio: 0.05,
        animations: "disabled",
        mask: [page.locator("img")],
      });
    } else {
      test.skip(true, "download button did not open a dialog");
    }
  });
});

test.describe("mobile visual regression — title page", () => {
  const slugs = TITLE_SLUGS.length
    ? TITLE_SLUGS
    : ["doraemon-the-movie-nobita-s-earth-symphony-2024"];

  for (const slug of slugs) {
    test(`title "${slug}" renders header, poster, downloads`, async ({ page }, info) => {
      await page.goto(`/title/${slug}`);
      await waitForFontsAndImages(page);

      await assertVisible(page, page.locator("header").first(), "site header");
      await assertVisible(page, page.getByRole("heading", { level: 1 }).first(), "title heading");
      await assertVisible(
        page,
        page.getByRole("heading", { name: /downloads/i }).first(),
        "downloads section",
      );

      await assertNoHorizontalOverflow(page);

      await expect(page).toHaveScreenshot(`title-${slug}-${info.project.name}.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.04,
        animations: "disabled",
        mask: [page.locator("img")],
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Aria-label coverage — runs on every project (320 / 360 / 375 / 390 / 414 / 768)
// Asserts that critical interactive elements are present, visible, and labeled.
// ---------------------------------------------------------------------------
test.describe("aria-label & interactive coverage — mobile", () => {
  test("homepage exposes labeled search, menu toggle, and brand link", async ({ page }, info) => {
    await page.goto("/");
    await waitForFontsAndImages(page);

    // Critical interactive elements MUST exist and be inside the viewport.
    const search = page.getByRole("button", { name: /search/i }).first();
    const menu = page.getByRole("button", { name: /toggle menu/i }).first();
    const brand = page.getByRole("link", { name: /streamvault/i }).first();
    await assertVisible(page, search, `[${info.project.name}] search button`);
    await assertVisible(page, menu, `[${info.project.name}] menu toggle`);
    await assertVisible(page, brand, `[${info.project.name}] brand`);

    // Every <button> and <a> in the header must be discoverable to AT — either
    // by visible text content or an aria-label / aria-labelledby reference.
    const issues = await page.locator("header button, header a").evaluateAll((els) =>
      els
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .filter((el) => {
          const text = (el.textContent ?? "").trim();
          const aria = el.getAttribute("aria-label");
          const labelled = el.getAttribute("aria-labelledby");
          return !text && !aria && !labelled;
        })
        .map((el) => el.outerHTML.slice(0, 120)),
    );
    expect(issues, `header has unlabeled controls: ${issues.join(" | ")}`).toEqual([]);

    // No element should be clipped horizontally off-viewport at any breakpoint.
    await assertNoHorizontalOverflow(page);
  });

  test("open mobile menu has no clipped category links", async ({ page }, info) => {
    await page.goto("/");
    await waitForFontsAndImages(page);
    const toggle = page.getByRole("button", { name: /toggle menu/i }).first();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    const viewport = page.viewportSize();
    const cats = page.locator("a", { hasText: /movie|series|anime|drama|cartoon/i });
    const count = await cats.count();
    expect(count, `[${info.project.name}] mobile menu should expose categories`).toBeGreaterThan(0);
    for (let i = 0; i < Math.min(count, 6); i++) {
      const box = await cats.nth(i).boundingBox();
      if (box && viewport) {
        expect(box.x).toBeGreaterThanOrEqual(-1);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
        expect(box.width).toBeGreaterThan(40);
        expect(box.height).toBeGreaterThanOrEqual(36);
      }
    }
  });
});
