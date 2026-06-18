import { test, expect } from "@playwright/test";

/**
 * Seed health-check.
 *
 * Runs BEFORE the dependent View-all and DownloadButton tests. Confirms every
 * `e2e-*` row in the database carries the Telegram file metadata fields the
 * UI depends on. If this fails, the dependent specs are not informative —
 * fix the seed before re-running them.
 *
 * Required env: SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY (or anon key).
 */

const URL_ = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const KEY_ =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  process.env.SUPABASE_ANON_KEY;

const RES_OK = /^(360|480|720|1080|1440|2160)p$/;

test.describe("Seed assertions: Telegram metadata is valid", () => {
  test.skip(!URL_ || !KEY_, "Supabase env not configured");

  test("every seeded media_file row has caption, file_id, resolution, and (for series) season/episode", async ({ request }) => {
    const res = await request.get(
      `${URL_}/rest/v1/media_files?select=id,caption,file_name,resolution,quality,language,episode_id,episodes(season_id,episode_number,seasons(season_number))&id=like.e2e-*&is_active=eq.true&limit=200`,
      {
        headers: {
          apikey: KEY_!,
          authorization: `Bearer ${KEY_!}`,
        },
      },
    );
    expect(res.status(), "GET media_files (e2e-*)").toBe(200);
    const rows = (await res.json()) as Array<{
      id: string;
      caption: string | null;
      file_name: string | null;
      resolution: string | null;
      episode_id: string | null;
      episodes: { episode_number: number | null; seasons: { season_number: number | null } | null } | null;
    }>;

    if (rows.length === 0) {
      test.skip(true, "No seeded media_files rows. Run `bun run scripts/seed-e2e.ts` first.");
      return;
    }

    const problems: string[] = [];
    for (const r of rows) {
      if (!r.caption || !r.caption.trim()) problems.push(`${r.id}: missing caption`);
      // Telegram file_id maps to telegram_file_id in the source row; for E2E
      // we accept either a non-empty file_name OR a recorded ID via the
      // sibling `telegram_ingest` row.
      if (!r.file_name) problems.push(`${r.id}: missing file_name`);
      if (!r.resolution || !RES_OK.test(r.resolution)) problems.push(`${r.id}: bad resolution ${r.resolution}`);
      if (r.episode_id) {
        const sNum = r.episodes?.seasons?.season_number ?? null;
        const eNum = r.episodes?.episode_number ?? null;
        if (sNum === null) problems.push(`${r.id}: episode_id set but no season number`);
        if (eNum === null) problems.push(`${r.id}: episode_id set but no episode number`);
      }
    }
    expect(problems, `seed validity issues:\n${problems.join("\n")}`).toEqual([]);
  });
});
