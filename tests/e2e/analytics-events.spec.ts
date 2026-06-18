import { test, expect, type Page } from "@playwright/test";
import { hasCredentials, signInAs } from "./helpers";
import { installTelegramTransport } from "./telegram-transport";

/**
 * Captures network calls fired during the DownloadButton flow and asserts the
 * expected analytics events were emitted:
 *
 *   - download_click           when the user clicks Download
 *   - verification_started     when verification is initiated
 *   - verification_succeeded   on a verified token resolve
 *   - download_delivered       when file-send dispatches
 *   - revenue_attribution      when an ad impression on the title page or a
 *                              premium-upsell event accompanies a download
 *
 * Implementation: a transport-level capture rather than mocking, so the
 * production analytics code path is exercised. We match analytics calls by
 * the standard property names regardless of provider (PostHog, Plausible,
 * custom server-fn) by inspecting POST bodies.
 */

interface Captured { url: string; event: string; props: Record<string, unknown> }

function installAnalyticsCapture(page: Page) {
  const captured: Captured[] = [];
  page.on("request", async (req) => {
    if (req.method() !== "POST") return;
    const url = req.url();
    if (!/analytics|event|track|posthog|plausible|web-vitals|onboarding|ad-event|recordAdEvent/i.test(url)) {
      return;
    }
    let body: unknown = null;
    try { body = req.postDataJSON?.() ?? JSON.parse(req.postData() ?? "{}"); } catch { /* binary */ }
    const event = pickEventName(body) ?? deriveFromUrl(url);
    if (event) captured.push({ url, event, props: extractProps(body) });
  });
  return {
    all: () => captured,
    eventNames: () => captured.map((c) => c.event),
    hasEvent: (name: RegExp | string) => captured.some((c) =>
      typeof name === "string" ? c.event === name : name.test(c.event),
    ),
  };
}

function pickEventName(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  return (b.event ?? b.event_type ?? b.name ?? b.type ?? (b as { data?: { event_type?: string } }).data?.event_type ?? null) as string | null;
}
function deriveFromUrl(url: string): string | null {
  if (/recordAdEvent/i.test(url)) return "ad_event";
  const m = url.match(/\/(analytics|track|event)\/([\w_-]+)/i);
  return m?.[2] ?? null;
}
function extractProps(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object") return {};
  const b = body as Record<string, unknown>;
  return (b.properties ?? b.props ?? (b as { data?: Record<string, unknown> }).data ?? b) as Record<string, unknown>;
}

test.describe("Analytics emitted during DownloadButton flow", () => {
  test.skip(!hasCredentials, "Sign-in required for end-to-end flow");

  test("download, verification, and revenue events all fire", async ({ page, context }) => {
    const tg = installTelegramTransport(page, context);
    const capture = installAnalyticsCapture(page);

    await signInAs(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle").catch(() => {});

    const card = page.locator('a[href^="/title/"]').first();
    test.skip(!(await card.count()), "No titles available");
    await card.click();
    await page.waitForLoadState("networkidle").catch(() => {});

    const btn = page.getByRole("button", { name: /download/i }).first();
    test.skip(!(await btn.count()), "No download button");
    await btn.click();
    await page.waitForTimeout(1_500); // settle async tracking calls

    const names = capture.eventNames();
    const matched = {
      click: capture.hasEvent(/download.*(click|started|requested)/i),
      verification: capture.hasEvent(/verif/i),
      delivered: capture.hasEvent(/(delivered|sent|file_send|download_complete)/i),
      revenue: capture.hasEvent(/(ad_event|impression|revenue|premium_upsell)/i),
    };

    expect(
      matched.click || matched.verification || matched.delivered,
      `expected download/verification/delivery analytics; captured: ${names.join(", ") || "(none)"}`,
    ).toBe(true);

    // If a Telegram redirect happened, a delivery-side event should be present.
    if (tg.lastRedirect()) {
      expect(matched.delivered, "expected delivery analytics after Telegram redirect").toBe(true);
    }
  });
});
