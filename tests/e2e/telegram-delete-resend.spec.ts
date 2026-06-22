import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { fireWebhook } from "./telegram-transport";

const URL_ = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

test.describe("Telegram delete + resend reconciliation", () => {
  test.skip(!URL_ || !SERVICE || !WEBHOOK_SECRET, "needs backend service key and Telegram webhook secret");

  const admin = createClient(URL_!, SERVICE!, { auth: { persistSession: false, autoRefreshToken: false } });
  const run = Date.now().toString(36);
  const titleId = randomUUID();
  const channelRowId = randomUUID();
  const chatId = -100777000111;
  const title = `Resend Titan ${run}`;
  const slug = `e2e-resend-titan-${run}`;
  const uniqueId = `e2e-resend-uniq-${run}`;
  const oldUpdateId = Date.now();
  const newUpdateId = oldUpdateId + 10;
  const oldMessageId = oldUpdateId + 1;
  const newMessageId = oldUpdateId + 2;
  let previousPublicBrowsing: unknown = null;

  test.beforeAll(async () => {
    const { data: setting } = await admin.from("app_settings").select("value").eq("key", "PUBLIC_BROWSING_ENABLED").maybeSingle();
    previousPublicBrowsing = setting?.value ?? null;
    await admin.from("app_settings").upsert({ key: "PUBLIC_BROWSING_ENABLED", value: "true", is_secret: false }, { onConflict: "key" });
    await admin.from("telegram_channels").upsert({
      id: channelRowId,
      channel_id: chatId,
      name: `E2E resend ${run}`,
      username: `e2e_resend_${run}`,
      is_active: true,
    }, { onConflict: "channel_id" });
    await admin.from("master_titles").upsert({
      id: titleId,
      slug,
      title,
      category: "anime",
      status: "published",
      release_year: null,
      rating: 8,
    }, { onConflict: "id" });
  });

  test.afterAll(async () => {
    await admin.from("media_files").delete().eq("telegram_file_unique_id", uniqueId);
    await admin.from("telegram_ingest").delete().eq("telegram_file_unique_id", uniqueId);
    await admin.from("telegram_webhook_events").delete().in("update_id", [oldUpdateId, newUpdateId]);
    await admin.from("episodes").delete().eq("title_id", titleId);
    await admin.from("seasons").delete().eq("title_id", titleId);
    await admin.from("telegram_channels").delete().eq("id", channelRowId);
    await admin.from("master_titles").delete().eq("id", titleId);
    await admin.from("app_settings").upsert({
      key: "PUBLIC_BROWSING_ENABLED",
      value: previousPublicBrowsing ?? "true",
      is_secret: false,
    }, { onConflict: "key" });
  });

  test("resend updates existing media row instead of creating a duplicate", async ({ request, page, baseURL }) => {
    const first = await fireWebhook(request, baseURL, {
      updateId: oldUpdateId,
      messageId: oldMessageId,
      chatId,
      fileId: `e2e-old-file-${run}`,
      fileUniqueId: uniqueId,
      fileName: `${title}.S01E01.480p.mkv`,
      caption: `${title}S01E01 480p Hindi`,
      fileSize: 480_000_000,
    });
    expect(first.status()).toBe(200);

    const second = await fireWebhook(request, baseURL, {
      updateId: newUpdateId,
      messageId: newMessageId,
      chatId,
      fileId: `e2e-new-file-${run}`,
      fileUniqueId: uniqueId,
      fileName: `${title}.S01E01.720p.fixed.mkv`,
      caption: `${title} S01E01 720p English`,
      fileSize: 720_000_000,
    });
    expect(second.status()).toBe(200);

    await expect(async () => {
      const { data, error } = await admin
        .from("media_files")
        .select("id, telegram_file_id, telegram_file_unique_id, telegram_message_id, file_name, caption, file_size, resolution, language, is_active, episode_id")
        .eq("telegram_file_unique_id", uniqueId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data![0]).toMatchObject({
        telegram_file_id: `e2e-new-file-${run}`,
        telegram_message_id: newMessageId,
        file_name: `${title}.S01E01.720p.fixed.mkv`,
        caption: `${title} S01E01 720p English`,
        file_size: 720_000_000,
        resolution: "720p",
        language: "English",
        is_active: true,
      });
      expect(data![0].episode_id).toBeTruthy();
    }).toPass({ timeout: 10_000, intervals: [500, 1_000, 2_000] });

    const { count } = await admin
      .from("media_files")
      .select("id", { count: "exact", head: true })
      .or(`telegram_file_unique_id.eq.${uniqueId},telegram_file_id.in.(e2e-old-file-${run},e2e-new-file-${run})`);
    expect(count).toBe(1);

    await page.goto(`/title/${slug}`);
    await expect(page.getByText(`${title} S01E01 720p English`)).toBeVisible();
    await expect(page.getByText(`${title}S01E01 480p Hindi`)).toHaveCount(0);
    await expect(page.getByText(/720p/).first()).toBeVisible();
    await expect(page.getByText(/ENGLISH/).first()).toBeVisible();
  });
});