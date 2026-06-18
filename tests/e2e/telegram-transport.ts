import type { Page, BrowserContext, APIRequestContext } from "@playwright/test";

/**
 * HTTP-transport mocks for Telegram redirects and the inbound webhook.
 *
 * These wrap the same endpoints CI uses against the deployed app:
 *   - Outbound `https://t.me/...` redirects are intercepted at the browser
 *     network layer, so a Download click does not leave the test sandbox.
 *   - Inbound webhook POSTs go to /api/public/telegram/webhook on the local
 *     dev server with the documented `X-Telegram-Bot-Api-Secret-Token`
 *     header, so the test exercises the real route + DB write path.
 *
 * Use from a test:
 *   const tg = installTelegramTransport(page, context);
 *   const res = await fireWebhook(request, baseURL, { caption: "..." });
 *   expect(tg.lastRedirect()).toMatch(/t\.me/);
 */

export interface TelegramTransport {
  lastRedirect: () => string | null;
  redirectCount: () => number;
  reset: () => void;
}

export function installTelegramTransport(
  page: Page,
  context: BrowserContext,
): TelegramTransport {
  let last: string | null = null;
  let count = 0;
  const track = (url: string) => {
    last = url;
    count += 1;
  };

  // Same-tab navigations to t.me / telegram.me return a tiny stub document.
  page.route(/https?:\/\/(t\.me|telegram\.me)\//, async (route) => {
    track(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: '<!doctype html><html><body data-telegram-mock="1"></body></html>',
    });
  }).catch(() => { /* may already be installed */ });

  // New-tab/popup opens are captured at the context level.
  context.on("page", (p) => {
    const u = p.url();
    if (/t\.me|telegram\.me/i.test(u)) track(u);
  });

  return {
    lastRedirect: () => last,
    redirectCount: () => count,
    reset: () => { last = null; count = 0; },
  };
}

export interface WebhookPayload {
  updateId?: number;
  caption?: string;
  fileName?: string;
  chatId?: number;
  fileSize?: number;
}

export async function fireWebhook(
  request: APIRequestContext,
  baseURL: string | undefined,
  payload: WebhookPayload = {},
) {
  const updateId = payload.updateId ?? Date.now();
  const body = {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: payload.chatId ?? -100100100100, type: "channel", title: "E2E" },
      from: { id: 1, is_bot: true, first_name: "Bot" },
      caption: payload.caption ?? "E2E Movie 2024 1080p WEB-DL Hindi",
      document: {
        file_id: `e2e-file-${updateId}`,
        file_unique_id: `e2e-uniq-${updateId}`,
        file_name: payload.fileName ?? "e2e.movie.2024.1080p.mkv",
        mime_type: "video/x-matroska",
        file_size: payload.fileSize ?? 1_500_000,
      },
    },
  };
  const url = new URL("/api/public/telegram/webhook", baseURL ?? "http://localhost:8080").toString();
  return request.post(url, {
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Bot-Api-Secret-Token": process.env.TELEGRAM_WEBHOOK_SECRET ?? "",
    },
    data: body,
  });
}
