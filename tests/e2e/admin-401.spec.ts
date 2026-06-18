import { test, expect } from "@playwright/test";

/**
 * Hitting a protected server function without a bearer token (or with an
 * obviously bogus one) MUST return a JSON 401 envelope, not an HTML 500
 * page or an empty body. The TanStack RPC client otherwise resolves to
 * `undefined` and callers crash with "can't access property X, r is
 * undefined".
 *
 * No credentials needed — this hits the raw /_serverFn/* endpoint directly.
 */

// Encoded server-function ID for getAdminGate.
// File: /src/lib/admin.functions.ts?tss-serverfn-split, Export: getAdminGate_createServerFn_handler
const ADMIN_GATE_FN_ID =
  "eyJmaWxlIjoiL3NyYy9saWIvYWRtaW4uZnVuY3Rpb25zLnRzP3Rzcy1zZXJ2ZXJmbi1zcGxpdCIsImV4cG9ydCI6ImdldEFkbWluR2F0ZV9jcmVhdGVTZXJ2ZXJGbl9oYW5kbGVyIn0";

test.describe("Admin server fn unauthorized handling", () => {
  test("missing Authorization header → JSON 401", async ({ request }) => {
    const res = await request.get(`/_serverFn/${ADMIN_GATE_FN_ID}`, {
      headers: { accept: "application/json" },
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(401);
    expect(res.headers()["content-type"] ?? "").toContain("application/json");
    const body = await res.json();
    expect(body).toMatchObject({ error: "unauthorized", status: 401 });
    expect(typeof body.message).toBe("string");
    expect(typeof body.timestamp).toBe("string");
  });

  test("bogus bearer token → JSON 401, never HTML", async ({ request }) => {
    const res = await request.get(`/_serverFn/${ADMIN_GATE_FN_ID}`, {
      headers: {
        accept: "application/json",
        authorization: "Bearer not-a-real-jwt",
      },
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(401);
    const ct = res.headers()["content-type"] ?? "";
    expect(ct).not.toContain("text/html");
    expect(ct).toContain("application/json");
  });

  test("unauthenticated /admin redirects to /auth (no blank screen)", async ({ page }) => {
    await page.goto("/admin");
    await page.waitForURL((u) => u.pathname.startsWith("/auth"), { timeout: 10_000 });
    const text = await page.textContent("body");
    expect((text ?? "").trim().length).toBeGreaterThan(20);
  });
});
