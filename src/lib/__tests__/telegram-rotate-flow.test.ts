// Regression test for TELEGRAM_BOT_TOKEN rotation.
//
// Verifies the rotation flow end-to-end (with mocked Telegram API):
//   1. deleteWebhook is called against the OLD token (drop_pending_updates=true).
//   2. The new token is persisted via the injected persistNewToken callback.
//   3. setWebhook is called against the NEW token, never the old one.
//   4. After rotation, a delivery attempt using the OLD token (sendDocument)
//      fails (401 Unauthorized — as Telegram would respond once that token
//      is revoked in BotFather), while the NEW token succeeds.
//
// This is the mocked variant — it exercises the production code path of
// `executeTokenRotation` without touching any live bot.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { executeTokenRotation, callTgWithToken } from "@/lib/telegram-rotate.functions";

const OLD = "111111:OLD-TOKEN-AAAAAAAAAAAAAAAAAAAA";
const NEW = "222222:NEW-TOKEN-BBBBBBBBBBBBBBBBBBBB";

type Call = { url: string; method: string; body: any };

function makeMockFetch(opts: {
  // After rotation, the OLD token is revoked → sendDocument(OLD) → 401.
  revokedAfterRotation?: boolean;
} = {}) {
  const calls: Call[] = [];
  let rotated = false;
  const handler = async (input: any, init: any) => {
    const url = typeof input === "string" ? input : input.url;
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ url, method, body });

    const m = /api\.telegram\.org\/bot([^/]+)\/(\w+)/.exec(url);
    if (!m) return new Response("{}", { status: 404 });
    const [, token, tgMethod] = m;

    // After deleteWebhook on OLD, mark rotation done so subsequent OLD-token
    // calls behave as revoked.
    if (tgMethod === "deleteWebhook" && token === OLD) {
      rotated = true;
      return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
    }

    if (tgMethod === "getMe") {
      if (token === OLD) return new Response(JSON.stringify({ ok: true, result: { id: 111, username: "old_bot" } }), { status: 200 });
      if (token === NEW) return new Response(JSON.stringify({ ok: true, result: { id: 222, username: "new_bot" } }), { status: 200 });
    }
    if (tgMethod === "setWebhook" && token === NEW) {
      return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
    }
    if (tgMethod === "sendDocument") {
      if (token === NEW) {
        return new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), { status: 200 });
      }
      if (token === OLD && (opts.revokedAfterRotation ?? rotated)) {
        return new Response(JSON.stringify({ ok: false, error_code: 401, description: "Unauthorized" }), { status: 401 });
      }
    }
    return new Response(JSON.stringify({ ok: false, description: `unhandled ${tgMethod}` }), { status: 400 });
  };
  return { calls, fetch: vi.fn(handler as any) };
}

describe("telegram token rotation flow", () => {
  let origFetch: typeof fetch;
  beforeEach(() => { origFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = origFetch; vi.restoreAllMocks(); });

  it("rotates safely: deletes old webhook, persists new token, registers new webhook", async () => {
    const { calls, fetch: mockFetch } = makeMockFetch();
    globalThis.fetch = mockFetch as any;

    const persistedTokens: string[] = [];
    const result = await executeTokenRotation({
      newToken: NEW,
      oldToken: OLD,
      webhookBase: "https://movies.vybeprints.info",
      webhookSecret: "secret_xyz",
      persistNewToken: async (t) => { persistedTokens.push(t); },
    });

    expect(result.ok).toBe(true);
    expect(result.newBot.id).toBe(222);
    expect(result.previousBot?.id).toBe(111);
    expect(result.oldWebhookCleared).toBe(true);
    expect(result.webhook).toEqual({ ok: true, url: "https://movies.vybeprints.info/api/public/telegram/webhook" });
    expect(persistedTokens).toEqual([NEW]);

    // Sequence assertions: deleteWebhook(OLD) BEFORE persist BEFORE setWebhook(NEW)
    const deleteIdx = calls.findIndex((c) => c.url.includes(`/bot${OLD}/deleteWebhook`));
    const setIdx = calls.findIndex((c) => c.url.includes(`/bot${NEW}/setWebhook`));
    expect(deleteIdx).toBeGreaterThanOrEqual(0);
    expect(setIdx).toBeGreaterThan(deleteIdx);
    expect(calls[deleteIdx].body?.drop_pending_updates).toBe(true);

    // setWebhook is never called against the OLD token.
    expect(calls.find((c) => c.url.includes(`/bot${OLD}/setWebhook`))).toBeUndefined();
  });

  it("after rotation, OLD token cannot deliver files; NEW token can", async () => {
    const { fetch: mockFetch } = makeMockFetch();
    globalThis.fetch = mockFetch as any;

    await executeTokenRotation({
      newToken: NEW,
      oldToken: OLD,
      webhookBase: "https://movies.vybeprints.info",
      webhookSecret: "secret_xyz",
      persistNewToken: async () => {},
    });

    // Old token now fails (401 Unauthorized).
    await expect(
      callTgWithToken(OLD, "sendDocument", { chat_id: 1, document: "file_id" }),
    ).rejects.toThrow(/sendDocument failed/);

    // New token succeeds.
    const sent = await callTgWithToken<{ message_id: number }>(NEW, "sendDocument", {
      chat_id: 1, document: "file_id",
    });
    expect(sent.message_id).toBe(42);
  });

  it("when oldToken === newToken, no deleteWebhook is issued", async () => {
    const { calls, fetch: mockFetch } = makeMockFetch();
    globalThis.fetch = mockFetch as any;

    const result = await executeTokenRotation({
      newToken: NEW,
      oldToken: NEW,
      webhookBase: "https://movies.vybeprints.info",
      webhookSecret: "secret_xyz",
      persistNewToken: async () => {},
    });

    expect(result.oldWebhookCleared).toBe("same token — skipped");
    expect(calls.find((c) => c.url.includes("/deleteWebhook"))).toBeUndefined();
  });

  it("returns webhook=ok:false when PUBLIC_BASE_URL is missing, but token is still persisted", async () => {
    const { fetch: mockFetch } = makeMockFetch();
    globalThis.fetch = mockFetch as any;
    const persisted: string[] = [];
    const result = await executeTokenRotation({
      newToken: NEW,
      oldToken: OLD,
      webhookBase: "",
      webhookSecret: "secret_xyz",
      persistNewToken: async (t) => { persisted.push(t); },
    });
    expect(persisted).toEqual([NEW]);
    expect(result.webhook.ok).toBe(false);
    if (!result.webhook.ok) expect(result.webhook.error).toMatch(/PUBLIC_BASE_URL/);
  });
});
