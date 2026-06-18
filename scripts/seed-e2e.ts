#!/usr/bin/env bun
/**
 * Deterministic seed for E2E tests.
 *
 * Writes a small, stable set of:
 *  - master_titles (one per homepage section)
 *  - announcements (one active)
 *  - ads          (one per placement)
 *  - homepage layout settings (section order)
 *
 * All rows use prefixed, stable IDs (`e2e-...`) so a re-run is idempotent
 * (delete-by-prefix, then upsert). Intended for a disposable preview DB —
 * never run against production. Requires SUPABASE_SERVICE_ROLE_KEY.
 *
 * Usage:  bun run scripts/seed-e2e.ts
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required.");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

const SECTIONS = [
  { key: "trending", category: "series", flags: { is_trending: true } },
  { key: "latest", category: "movie", flags: {} },
  { key: "movies", category: "movie", flags: {} },
  { key: "anime", category: "anime", flags: {} },
] as const;

async function wipeExisting() {
  await supabase.from("master_titles").delete().like("id", "e2e-%");
  await supabase.from("announcements").delete().like("id", "e2e-%");
  await supabase.from("ads").delete().like("id", "e2e-%");
}

async function seedTitles() {
  const rows: Array<Record<string, unknown>> = [];
  for (const section of SECTIONS) {
    for (let i = 1; i <= 6; i++) {
      rows.push({
        id: `e2e-${section.key}-${i}`,
        slug: `e2e-${section.key}-${i}`,
        title: `E2E ${section.key} ${i}`,
        category: section.category,
        status: "published",
        release_year: 2020 + (i % 5),
        rating: 7 + (i % 3),
        view_count: 100 - i,
        ...section.flags,
      });
    }
  }
  const { error } = await supabase.from("master_titles").upsert(rows, { onConflict: "id" });
  if (error) throw error;
  console.log(`seeded ${rows.length} titles`);
}

async function seedAnnouncement() {
  const now = Date.now();
  const { error } = await supabase.from("announcements").upsert([{
    id: "e2e-announcement-1",
    body: "E2E announcement — site-wide notice",
    variant: "info",
    is_active: true,
    starts_at: new Date(now - 60_000).toISOString(),
    ends_at: new Date(now + 24 * 60 * 60_000).toISOString(),
  }], { onConflict: "id" });
  if (error) throw error;
  console.log("seeded 1 announcement");
}

async function seedAds() {
  const placements = ["homepage_banner", "between_rows", "title_page", "before_download"];
  const rows = placements.map((p, i) => ({
    id: `e2e-ad-${p}`,
    name: `E2E ${p}`,
    placement: p,
    kind: "image",
    image_url: `https://placehold.co/728x90?text=${encodeURIComponent(p)}`,
    is_active: true,
    sort_order: i,
  }));
  const { error } = await supabase.from("ads").upsert(rows, { onConflict: "id" });
  if (error) throw error;
  console.log(`seeded ${rows.length} ads`);
}

async function seedLayout() {
  const { error } = await supabase.from("app_settings").upsert([{
    key: "homepage_section_order",
    value: { order: SECTIONS.map((s) => s.key) },
  }], { onConflict: "key" });
  if (error && !`${error.message}`.includes("does not exist")) throw error;
  console.log("seeded homepage layout");
}

await wipeExisting();
await seedTitles();
await seedAnnouncement();
await seedAds();
await seedLayout().catch((e) => console.warn("layout seed skipped:", e.message));
console.log("E2E seed complete.");
