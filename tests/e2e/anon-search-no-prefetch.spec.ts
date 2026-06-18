import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { signOut } from "./helpers";

/**
 * E2E: when public browsing is OFF, anonymous client navigation through
 * /search must not load or prefetch protected title-detail data.
 *
 * We assert:
 *  1. No /title/<slug> anchors appear in the rendered search results.
 *  2. No network request to PostgREST `master_titles` (single-row detail
 *     query) is made while hovering / focusing search results — i.e. the
 *     router prefetch is gated by the toggle.
 */

const URL_ =
  process.env.SUPABASE_URL ??
  process.env.VITE_SUPABASE_URL ??
  "https://ehjkzvddtgljntwwasui.supabase.co";
const ANON = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

test.describe("search does not prefetch title detail when toggle OFF", () => {
  test.skip(!ANON || !SERVICE, "needs SUPABASE_SERVICE_ROLE_KEY + publishable key");

  const admin = createClient(URL_, SERVICE!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  test.beforeAll(async () => {
    await admin
      .from("app_settings")
      .upsert(
        { key: "PUBLIC_BROWSING_ENABLED", value: "false", is_secret: false },
        { onConflict: "key" },
      );
  });

  test.afterAll(async () => {
    await admin
      .from("app_settings")
      .upsert(
        { key: "PUBLIC_BROWSING_ENABLED", value: "true", is_secret: false },
        { onConflict: "key" },
      );
  });

  test("search yields no title anchors and no detail prefetch network calls", async ({ page }) => {
    await page.goto("/");
    await signOut(page);

    const detailRequests: string[] = [];
    page.on("request", (req) => {
      const u = req.url();
      // PostgREST detail-ish reads — single-row selects against master_titles
      // or media_files / seasons / episodes. Any of these from anon would
      // indicate a prefetch leak.
      if (
        /\/rest\/v1\/(master_titles|media_files|seasons|episodes)\?/.test(u) &&
        /(\.eq\.|slug=eq\.|id=eq\.)/.test(decodeURIComponent(u))
      ) {
        detailRequests.push(u);
      }
    });

    await page.goto("/search?q=a");
    await page.waitForLoadState("networkidle");

    // No title anchors should be present.
    expect(await page.locator('a[href^="/title/"]').count()).toBe(0);

    // Hover over the search input and tab around — simulate fast client nav.
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.waitForTimeout(500);

    expect(
      detailRequests,
      `expected no detail prefetch, got:\n${detailRequests.join("\n")}`,
    ).toEqual([]);
  });

  test("homepage sections do not prefetch detail rows for anon", async ({ page }) => {
    const detailRequests: string[] = [];
    page.on("request", (req) => {
      const u = req.url();
      if (
        /\/rest\/v1\/(media_files|seasons|episodes)\?/.test(u) &&
        /(\.eq\.|title_id=eq\.|season_id=eq\.)/.test(decodeURIComponent(u))
      ) {
        detailRequests.push(u);
      }
    });

    await page.goto("/");
    await signOut(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    expect(detailRequests).toEqual([]);
  });
});
