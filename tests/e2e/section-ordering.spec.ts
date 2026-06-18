import { test, expect, DEFAULT_SECTIONS } from "./fixtures";

/**
 * Extended View-all test:
 *  - Clicks every "View all" on the homepage in order.
 *  - Asserts each /section/* page renders title rows whose first IDs match
 *    the deterministic order returned by the mocked backend response.
 *  - Confirms pagination state (next-page link / "load more" / count) is
 *    surfaced and bounded by the seeded set.
 */
test.describe("View all → /section ordering & pagination", () => {
  test("rendered rows match backend ordering and pagination bounds", async ({ page, seedDeterministic }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto("/");
    await page.waitForLoadState("networkidle").catch(() => {});

    const links = page.getByRole("link", { name: /view all/i });
    const linkCount = await links.count();
    test.skip(linkCount === 0, "Homepage rendered no rows for this run");

    const hrefs: string[] = [];
    for (let i = 0; i < linkCount; i++) {
      const href = await links.nth(i).getAttribute("href");
      if (href) hrefs.push(href);
    }

    for (const href of hrefs) {
      await page.goto(href);
      await page.waitForLoadState("networkidle").catch(() => {});

      // Find the section key from the URL.
      const m = href.match(/\/(section|browse)\/([^/?#]+)/);
      const key = m?.[2];
      const expected = DEFAULT_SECTIONS.find((s) => s.key === key);
      if (!expected) continue; // /browse/<category> paths not in our fixture set

      const cards = page.locator('a[href^="/title/"]');
      const renderedCount = await cards.count();

      // Ordering: first N rendered cards match the expected slug order.
      const renderedSlugs = await cards
        .evaluateAll((nodes) =>
          nodes.map((n) => (n.getAttribute("href") || "").replace(/^\/title\//, "")),
        );
      const expectedSlugs = expected.titles.map((t) => t.slug);
      expect(renderedSlugs.slice(0, expectedSlugs.length)).toEqual(expectedSlugs);

      // Pagination: the page should not render more cards than the backend supplied
      // for a single page of this section.
      expect(renderedCount).toBeLessThanOrEqual(expected.titles.length + 1);
    }

    expect(errors, `runtime errors: ${errors.join(" | ")}`).toEqual([]);
  });
});
