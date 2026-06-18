import { test, expect, request as pwRequest } from "@playwright/test";

/**
 * Validates that /api/public/telegram/webhook rejects requests whose
 * X-Telegram-Bot-Api-Secret-Token does not exactly match the configured
 * secret (timing-safe equality on the server).
 *
 * The endpoint is the production-shape route, so this also covers the
 * "missing header" and "wrong-length header" cases.
 */

const PATH = "/api/public/telegram/webhook";
const SAMPLE_UPDATE = {
  update_id: 999_000_001,
  message: { message_id: 1, date: 0, chat: { id: 1, type: "private" }, from: { id: 1, is_bot: false, first_name: "x" }, text: "/id" },
};

test.describe("Telegram webhook signature", () => {
  test("rejects missing secret header with 401", async ({ baseURL }) => {
    const ctx = await pwRequest.newContext({ baseURL });
    const res = await ctx.post(PATH, { data: SAMPLE_UPDATE, headers: { "content-type": "application/json" } });
    expect(res.status(), await res.text()).toBe(401);
  });

  test("rejects empty secret header with 401", async ({ baseURL }) => {
    const ctx = await pwRequest.newContext({ baseURL });
    const res = await ctx.post(PATH, {
      data: SAMPLE_UPDATE,
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "" },
    });
    expect(res.status()).toBe(401);
  });

  test("rejects wrong-length secret with 401 (not 200/500)", async ({ baseURL }) => {
    const ctx = await pwRequest.newContext({ baseURL });
    const res = await ctx.post(PATH, {
      data: SAMPLE_UPDATE,
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "x" },
    });
    expect(res.status()).toBe(401);
  });

  test("rejects wrong-value secret of matching shape with 401", async ({ baseURL }) => {
    // Fabricated 43-char base64url string — same shape as the real secret but
    // not the real value. Must still be rejected.
    const fake = "A".repeat(43);
    const ctx = await pwRequest.newContext({ baseURL });
    const res = await ctx.post(PATH, {
      data: SAMPLE_UPDATE,
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": fake },
    });
    expect(res.status()).toBe(401);
    // Must not leak that "secret was present but wrong" vs "missing" via a
    // different body — both rejection bodies start with "Unauthorized".
    expect((await res.text()).toLowerCase()).toContain("unauthorized");
  });

  test("does not accept GET (only POST handler exists)", async ({ baseURL }) => {
    const ctx = await pwRequest.newContext({ baseURL });
    const res = await ctx.get(PATH);
    expect([404, 405]).toContain(res.status());
  });
});
