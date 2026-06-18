import { test as base, expect, type Page, type Route } from "@playwright/test";

/**
 * Shared E2E fixtures.
 *
 *  - `mockTelegram`         intercepts Telegram redirects (t.me / telegram.me) so a
 *                           click on Download lands on a stub URL instead of a real chat.
 *  - `mockVerification`     intercepts server-fn calls that verify the user's link-shortener
 *                           token. Default: verified. Toggle via `setVerified(false)`.
 *  - `mockFileSend`         intercepts the file-send / delivery endpoint and records every
 *                           call so tests can assert it fired with the right payload.
 *  - `seedDeterministic`    seeds in-flight responses for homepage layout, sections, and
 *                           ads so View-all + /section/ tests run against stable IDs.
 *
 * All fixtures auto-apply by attaching `page.route()` interceptors before navigation.
 * Tests can override individual mocks per-test by calling the returned setters.
 */

export interface TelegramController {
  /** Last URL the user was (would have been) redirected to. */
  lastRedirectUrl: () => string | null;
}

export interface VerificationController {
  setVerified: (verified: boolean) => void;
  setShortenerUrl: (url: string | null) => void;
  /** Number of verification calls observed. */
  calls: () => number;
}

export interface FileSendController {
  /** Payloads (parsed JSON) for every observed send call. */
  payloads: () => unknown[];
  /** Override the canned success response. */
  setResponse: (resp: { ok: boolean; deliveryId?: string; error?: string }) => void;
}

export interface SeedController {
  sections: typeof DEFAULT_SECTIONS;
  announcements: typeof DEFAULT_ANNOUNCEMENTS;
  ads: typeof DEFAULT_ADS;
  setSections: (s: typeof DEFAULT_SECTIONS) => void;
}

export const DEFAULT_SECTIONS = [
  { key: "trending", title: "Trending now", titles: makeTitles("trending", 6) },
  { key: "latest", title: "Latest additions", titles: makeTitles("latest", 6) },
  { key: "movies", title: "Movies", titles: makeTitles("movies", 6) },
  { key: "anime", title: "Anime", titles: makeTitles("anime", 6) },
];

export const DEFAULT_ANNOUNCEMENTS = [
  {
    id: "ann-e2e-1",
    body: "E2E announcement",
    variant: "info",
    is_active: true,
    starts_at: new Date(Date.now() - 60_000).toISOString(),
    ends_at: new Date(Date.now() + 60 * 60_000).toISOString(),
  },
];

export const DEFAULT_ADS = [
  { id: "ad-banner-1", placement: "homepage_banner", kind: "image", image_url: "https://placehold.co/728x90", name: "Banner 1", sort_order: 0, is_active: true },
  { id: "ad-between-1", placement: "between_rows", kind: "image", image_url: "https://placehold.co/728x90", name: "Between 1", sort_order: 0, is_active: true },
];

function makeTitles(prefix: string, n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-id-${i + 1}`,
    slug: `${prefix}-slug-${i + 1}`,
    title: `${prefix.toUpperCase()} Title ${i + 1}`,
    poster_url: null,
    release_year: 2020 + (i % 5),
    rating: 7 + (i % 3),
    category: prefix === "anime" ? "anime" : prefix === "movies" ? "movie" : "series",
  }));
}

async function jsonRoute(route: Route, payload: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
}

export const test = base.extend<{
  mockTelegram: TelegramController;
  mockVerification: VerificationController;
  mockFileSend: FileSendController;
  seedDeterministic: SeedController;
}>({
  mockTelegram: async ({ page, context }, use) => {
    let lastUrl: string | null = null;
    // Intercept popup opens (target=_blank) at the browser level.
    context.on("page", (p) => {
      const url = p.url();
      if (/t\.me|telegram\.me/i.test(url)) lastUrl = url;
    });
    // Same-tab Telegram navigations: short-circuit with an empty 200.
    await page.route(/https?:\/\/(t\.me|telegram\.me)\//, async (route) => {
      lastUrl = route.request().url();
      await route.fulfill({ status: 200, contentType: "text/html", body: "<!-- mocked telegram -->" });
    });
    await use({ lastRedirectUrl: () => lastUrl });
  },

  mockVerification: async ({ page }, use) => {
    let verified = true;
    let shortenerUrl: string | null = null;
    let calls = 0;
    await page.route(/verification|verify/i, async (route) => {
      calls += 1;
      await jsonRoute(route, {
        result: {
          data: {
            verified,
            requireVerification: !verified,
            token: verified ? "tok_e2e_123" : null,
            shortenerUrl,
          },
        },
      });
    });
    await use({
      setVerified: (v) => { verified = v; },
      setShortenerUrl: (u) => { shortenerUrl = u; },
      calls: () => calls,
    });
  },

  mockFileSend: async ({ page }, use) => {
    const payloads: unknown[] = [];
    let response: { ok: boolean; deliveryId?: string; error?: string } = {
      ok: true,
      deliveryId: "d_e2e_1",
    };
    await page.route(/(download|delivery|telegram).*(send|deliver)/i, async (route) => {
      try {
        const body = route.request().postData();
        if (body) payloads.push(JSON.parse(body));
      } catch { /* non-JSON */ }
      await jsonRoute(route, { result: { data: response } });
    });
    await use({
      payloads: () => payloads,
      setResponse: (r) => { response = r; },
    });
  },

  seedDeterministic: async ({ page }, use) => {
    let sections = DEFAULT_SECTIONS;
    const announcements = DEFAULT_ANNOUNCEMENTS;
    const ads = DEFAULT_ADS;

    await page.route(/announcement/i, (route) => jsonRoute(route, { result: { data: announcements }, data: announcements }));
    await page.route(/listActiveAds|ads.*placement|ads\.functions/i, (route) => {
      const url = route.request().url();
      const match = url.match(/placement=(\w+)/);
      const filtered = match ? ads.filter((a) => a.placement === match[1]) : ads;
      jsonRoute(route, { result: { data: { ads: filtered } } });
    });
    await page.route(/homepageLayout|homepage\.functions|getHomepageLayout/i, (route) => {
      jsonRoute(route, {
        result: {
          data: {
            slideshowEnabled: false,
            slides: [],
            sectionOrder: sections.map((s) => s.key),
          },
        },
      });
    });

    await use({
      sections,
      announcements,
      ads,
      setSections: (s) => { sections = s; },
    });
  },
});

export { expect };
export type { Page };
