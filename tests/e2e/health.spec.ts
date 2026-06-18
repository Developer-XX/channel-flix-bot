import { test, expect } from "@playwright/test";

/**
 * Verifies the health endpoint and serverFn registry are operational, which
 * is a fast smoke check we run before the admin-gating suite.
 */

test("GET /api/public/health returns ok with a buildId", async ({ request }) => {
  const res = await request.get("/api/public/health");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.status).toBe("ok");
  expect(typeof body.buildId).toBe("string");
  expect(body.buildId.length).toBeGreaterThan(0);
});

test("Critical serverFns are registered (no 404 from manifest)", async ({ request }) => {
  // A POST without auth should return 401, never 404. 404 here means the
  // function ID is no longer registered — the exact regression we want to
  // catch automatically.
  const fnIds = [
    // base64({file: "/src/lib/admin.functions.ts?tss-serverfn-split", export: "getAdminGate_createServerFn_handler"})
    "eyJmaWxlIjoiL3NyYy9saWIvYWRtaW4uZnVuY3Rpb25zLnRzP3Rzcy1zZXJ2ZXJmbi1zcGxpdCIsImV4cG9ydCI6ImdldEFkbWluR2F0ZV9jcmVhdGVTZXJ2ZXJGbl9oYW5kbGVyIn0",
  ];
  for (const id of fnIds) {
    const res = await request.get(`/_serverFn/${id}`);
    expect(res.status(), `serverFn ${id} unexpectedly 404`).not.toBe(404);
  }
});
