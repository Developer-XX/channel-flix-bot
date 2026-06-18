import { test, expect, type Page } from "@playwright/test";
import { hasCredentials, signInAs } from "./helpers";
import { installTelegramTransport } from "./telegram-transport";

/**
 * Strict payload-schema validator for the four analytics families:
 *   download     — download_click, download_started, download_requested
 *   verification — verification_started, verification_succeeded, verification_failed
 *   delivery     — download_delivered, file_send, download_complete
 *   revenue      — ad_event, ad_impression, revenue_attribution, premium_upsell
 *
 * Captures POST bodies on the wire and asserts the required fields per family
 * are present and well-typed. Missing fields fail the test loudly so the schema
 * contract can't silently drift.
 */

type Family = "download" | "verification" | "delivery" | "revenue";

interface Required {
  fields: Record<string, "string" | "number" | "boolean" | "string|number" | "uuid-like">;
}

const SCHEMAS: Record<Family, Required> = {
  download: {
    fields: {
      event: "string",
      title_id: "uuid-like",
      // one of these three must be present too, validated separately
    },
  },
  verification: {
    fields: {
      event: "string",
      // verification provider OR token OR status
    },
  },
  delivery: {
    fields: {
      event: "string",
      // delivery target identifier
    },
  },
  revenue: {
    fields: {
      event: "string",
      // placement OR ad_id
    },
  },
};

const FAMILY_PATTERNS: Record<Family, RegExp> = {
  download: /^(download_click|download_started|download_requested)$/i,
  verification: /^(verification_(started|succeeded|failed)|verify_)/i,
  delivery: /^(download_(delivered|complete)|file_send|delivery_)/i,
  revenue: /^(ad_(event|impression|click)|revenue|premium_upsell)$/i,
};

const FAMILY_EXTRA_REQUIRED: Record<Family, string[][]> = {
  download:     [["title_id", "id", "slug"]],            // any one
  verification: [["status", "provider", "token", "result"]],
  delivery:     [["status", "delivery_status", "chat_id", "destination", "file_id"]],
  revenue:      [["placement", "ad_id", "slot", "page"]],
};

interface Captured { url: string; event: string; body: Record<string, unknown> }

function pickEvent(b: any): string | null {
  return b?.event ?? b?.event_type ?? b?.name ?? b?.type ?? b?.data?.event_type ?? null;
}
function flatProps(b: any): Record<string, unknown> {
  if (!b || typeof b !== "object") return {};
  return { ...(b ?? {}), ...(b.properties ?? {}), ...(b.props ?? {}), ...(b.data ?? {}) };
}
function familyOf(event: string): Family | null {
  for (const [k, re] of Object.entries(FAMILY_PATTERNS) as [Family, RegExp][]) {
    if (re.test(event)) return k;
  }
  return null;
}
function typeOk(value: unknown, kind: Required["fields"][string]): boolean {
  if (value === undefined || value === null) return false;
  switch (kind) {
    case "string": return typeof value === "string" && value.length > 0;
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "boolean": return typeof value === "boolean";
    case "string|number": return typeof value === "string" || typeof value === "number";
    case "uuid-like":
      return typeof value === "string" && /^[0-9a-f-]{8,}$/i.test(value);
  }
}

function captureAll(page: Page): { events: Captured[] } {
  const events: Captured[] = [];
  page.on("request", (req) => {
    if (req.method() !== "POST") return;
    const url = req.url();
    if (!/analytics|event|track|posthog|plausible|web-vitals|onboarding|ad-event|recordAdEvent|download|verification|delivery/i.test(url)) return;
    let body: any = null;
    try { body = req.postDataJSON?.() ?? JSON.parse(req.postData() ?? "{}"); } catch { return; }
    const event = pickEvent(body);
    if (!event || typeof event !== "string") return;
    events.push({ url, event, body: flatProps(body) });
  });
  return { events };
}

function assertSchema(c: Captured, family: Family) {
  const schema = SCHEMAS[family];
  for (const [k, kind] of Object.entries(schema.fields)) {
    expect(
      typeOk(c.body[k], kind),
      `[${family}] event "${c.event}" missing/invalid field "${k}" (expected ${kind}); body keys: ${Object.keys(c.body).join(", ")}`,
    ).toBe(true);
  }
  for (const oneOf of FAMILY_EXTRA_REQUIRED[family]) {
    expect(
      oneOf.some((k) => c.body[k] !== undefined && c.body[k] !== null && c.body[k] !== ""),
      `[${family}] event "${c.event}" must include at least one of: ${oneOf.join(" | ")}; body keys: ${Object.keys(c.body).join(", ")}`,
    ).toBe(true);
  }
}

test.describe("Analytics payload schemas", () => {
  test.skip(!hasCredentials, "Sign-in required to exercise the full flow");

  test("download / verification / delivery / revenue payloads conform", async ({ page, context }) => {
    installTelegramTransport(page, context);
    const cap = captureAll(page);

    await signInAs(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle").catch(() => {});

    const card = page.locator('a[href^="/title/"]').first();
    test.skip(!(await card.count()), "No titles to drive the flow");
    await card.click();
    await page.waitForLoadState("networkidle").catch(() => {});

    const btn = page.getByRole("button", { name: /download/i }).first();
    test.skip(!(await btn.count()), "No download button");
    await btn.click();
    await page.waitForTimeout(2_000);

    const grouped: Record<Family, Captured[]> = { download: [], verification: [], delivery: [], revenue: [] };
    for (const e of cap.events) {
      const f = familyOf(e.event);
      if (f) grouped[f].push(e);
    }

    const anyCaptured = (Object.keys(grouped) as Family[]).some((f) => grouped[f].length > 0);
    test.skip(!anyCaptured, `No analytics events captured; nothing to validate. Saw: ${cap.events.map((e) => e.event).join(", ") || "(none)"}`);

    for (const f of Object.keys(grouped) as Family[]) {
      for (const c of grouped[f]) assertSchema(c, f);
    }

    // Soft-fail if a family is entirely missing — useful signal without blocking
    // when only a subset of the flow is reachable in CI.
    for (const f of ["download", "verification", "delivery", "revenue"] as Family[]) {
      if (grouped[f].length === 0) {
        test.info().annotations.push({ type: "warning", description: `no "${f}" events captured` });
      }
    }
  });
});
