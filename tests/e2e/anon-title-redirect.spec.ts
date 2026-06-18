import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { signOut } from "./helpers";

/**
 * E2E: when public browsing is disabled, anonymous users opening title detail
 * routes directly (or via search/homepage/section prefetch) get redirected to
 * /auth with a redirect-back search param, and never see protected detail data.
 *
 * Requires service-role to flip the toggle. Skips gracefully without it.
 */

const URL_ =
  process.env.SUPABASE_URL ??
  process.env.VITE_SUPABASE_URL ??
  "https://ehjkzvddtgljntwwasui.supabase.co";
const ANON = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

test.describe("anonymous title-detail redirect when public browsing OFF", () => {
  test.skip(!ANON || !SERVICE, "needs SUPABASE_SERVICE_ROLE_KEY + publishable key");

  const admin = createClient(URL_, SERVICE!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anon = createClient(URL_, ANON!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let slug: string | null = null;

  test.beforeAll(async () => {
    // Capture a real published slug while toggle is ON, so we have a route to hit.
    await admin
      .from("app_settings")
      .upsert(
        { key: "PUBLIC_BROWSING_ENABLED", value: "true", is_secret: false },
        { onConflict: "key" },
      );
    const { data } = await admin
      .from("master_titles")
      .select("slug")
      .eq("status", "published")
      .limit(1)
      .maybeSingle();
    slug = data?.slug ?? null;

    // Flip toggle OFF for the test.
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

  test("direct /title/:slug visit redirects to /auth with ?redirect=", async ({ page }) => {
    test.skip(!slug, "no published title to test against");
    await page.goto("/");
    await signOut(page);

    const target = `/title/${slug}`;
    await page.goto(target);
    await page.waitForURL(/\/auth/, { timeout: 10_000 });

    const url = new URL(page.url());
    expect(url.pathname).toBe("/auth");
    expect(url.searchParams.get("redirect")).toContain(`/title/${slug}`);
  });

  test("/browse/:category visit redirects to /auth", async ({ page }) => {
    await page.goto("/");
    await signOut(page);
    await page.goto("/browse/movies");
    await page.waitForURL(/\/auth/, { timeout: 10_000 });
    expect(new URL(page.url()).searchParams.get("redirect")).toContain("/browse/");
  });

  test("/section/:key visit redirects to /auth", async ({ page }) => {
    await page.goto("/");
    await signOut(page);
    await page.goto("/section/trending");
    await page.waitForURL(/\/auth/, { timeout: 10_000 });
    expect(new URL(page.url()).searchParams.get("redirect")).toContain("/section/");
  });

  test("anon DB layer rejects detail-data reads (defense in depth)", async () => {
    const titles = await anon
      .from("master_titles")
      .select("id, slug")
      .eq("status", "published")
      .limit(5);
    expect(titles.error).toBeNull();
    expect(titles.data ?? []).toEqual([]);

    const files = await anon.from("media_files").select("id").limit(1);
    expect(files.data ?? []).toEqual([]);

    const seasons = await anon.from("seasons").select("id").limit(1);
    expect(seasons.data ?? []).toEqual([]);

    const episodes = await anon.from("episodes").select("id").limit(1);
    expect(episodes.data ?? []).toEqual([]);
  });

  test("search and homepage do not leak protected title data", async ({ page }) => {
    await page.goto("/");
    await signOut(page);

    // Homepage rows should not surface any /title/<slug> anchors when toggle is OFF.
    await page.goto("/");
    const anchors = await page.locator('a[href^="/title/"]').count();
    expect(anchors).toBe(0);

    await page.goto("/search?q=a");
    // search results should also be empty for anon when toggle is OFF
    const searchAnchors = await page.locator('a[href^="/title/"]').count();
    expect(searchAnchors).toBe(0);
  });
});
