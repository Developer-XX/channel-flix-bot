#!/usr/bin/env bun
/**
 * Deterministic seed for the admin-dashboards-smoke / pagination /
 * failure-state Playwright suites.
 *
 * Inserts a stable, prefixed dataset into:
 *   - public.shortener_configs       (4 providers)
 *   - public.shortener_health_log    (240 samples — 60 per provider over
 *                                     last 30 days, deterministic ok/latency)
 *   - public.telegram_channels       (3 e2e channels)
 *   - public.master_titles           (2 series titles)
 *   - public.telegram_ingest         (60 rows: some unmatched, some with
 *                                     SxxPyEzz mismatches → drives the
 *                                     episode-audit dashboard)
 *
 * All rows use the `e2e-` id prefix or the `e2e:` provider prefix so the
 * seed is fully idempotent (delete-by-prefix, then upsert). Safe to run
 * repeatedly against a disposable preview database — never run against
 * production.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... bun run scripts/seed-e2e-shortener-audit.ts
 *
 * The Playwright specs read the same constants exported below so the
 * assertions stay in lockstep with what the seed produced.
 */
import { createClient } from "@supabase/supabase-js";

export const E2E_SHORTENER_PROVIDERS = [
  "e2e:nanolinks",
  "e2e:adrinolinks",
  "e2e:shortener-c",
  "e2e:shortener-d",
] as const;

export const E2E_SAMPLES_PER_PROVIDER = 60;
export const E2E_TOTAL_SAMPLES =
  E2E_SHORTENER_PROVIDERS.length * E2E_SAMPLES_PER_PROVIDER;

export const E2E_CHANNELS = [
  { id: "e2e-channel-a", name: "E2E Channel A", username: "e2e_chan_a", telegram_id: -10010000001 },
  { id: "e2e-channel-b", name: "E2E Channel B", username: "e2e_chan_b", telegram_id: -10010000002 },
  { id: "e2e-channel-c", name: "E2E Channel C", username: "e2e_chan_c", telegram_id: -10010000003 },
] as const;

export const E2E_TITLES = [
  { id: "e2e-title-bear", slug: "e2e-the-bear", title: "E2E The Bear", category: "series" as const },
  { id: "e2e-title-loki", slug: "e2e-loki", title: "E2E Loki", category: "series" as const },
] as const;

export const E2E_INGEST_ROWS = 60;

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required.");
    process.exit(1);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // ---------- 1. wipe by prefix (idempotent) ----------
  await supabase.from("shortener_health_log").delete().in("provider", [...E2E_SHORTENER_PROVIDERS]);
  await supabase.from("shortener_configs").delete().in("provider", [...E2E_SHORTENER_PROVIDERS]);
  await supabase.from("telegram_ingest").delete().like("id", "e2e-ingest-%");
  await supabase.from("master_titles").delete().in("id", E2E_TITLES.map((t) => t.id));
  await supabase.from("telegram_channels").delete().in("id", E2E_CHANNELS.map((c) => c.id));

  // ---------- 2. shortener_configs ----------
  const configRows = E2E_SHORTENER_PROVIDERS.map((p, i) => ({
    provider: p,
    enabled: true,
    priority: 100 + i,
    weight: 1,
    notes: "seeded by e2e",
  }));
  {
    const { error } = await supabase
      .from("shortener_configs")
      .upsert(configRows, { onConflict: "provider" });
    if (error) throw error;
    console.log(`seeded ${configRows.length} shortener_configs`);
  }

  // ---------- 3. shortener_health_log ----------
  // Deterministic: 60 samples per provider spread evenly across the last
  // 30 days. ok=true 80% of the time; latency = 200 + (idx % 7) * 50 ms.
  // Failure rows include a stable `error` string so the perf-regression
  // test can assert non-empty buckets.
  const now = Date.now();
  const day = 86_400_000;
  const samples: Array<Record<string, unknown>> = [];
  for (const provider of E2E_SHORTENER_PROVIDERS) {
    for (let i = 0; i < E2E_SAMPLES_PER_PROVIDER; i++) {
      const ok = i % 5 !== 0; // 80% success
      samples.push({
        provider,
        ok,
        latency_ms: 200 + (i % 7) * 50,
        checked_at: new Date(now - i * (30 * day / E2E_SAMPLES_PER_PROVIDER)).toISOString(),
        http_status: ok ? 200 : 502,
        error: ok ? null : "e2e: simulated upstream 502",
        source: "e2e-seed",
      });
    }
  }
  {
    const { error } = await supabase.from("shortener_health_log").insert(samples);
    if (error) throw error;
    console.log(`seeded ${samples.length} shortener_health_log rows`);
  }

  // ---------- 4. telegram_channels + master_titles ----------
  {
    const { error } = await supabase
      .from("telegram_channels")
      .upsert(E2E_CHANNELS.map((c) => ({ ...c })), { onConflict: "id" });
    if (error) throw error;
    console.log(`seeded ${E2E_CHANNELS.length} telegram_channels`);
  }
  {
    const { error } = await supabase
      .from("master_titles")
      .upsert(
        E2E_TITLES.map((t) => ({
          ...t,
          status: "published",
          release_year: 2022,
        })),
        { onConflict: "id" },
      );
    if (error) throw error;
    console.log(`seeded ${E2E_TITLES.length} master_titles`);
  }

  // ---------- 5. telegram_ingest (episode-audit fixtures) ----------
  // Mix of statuses so the audit dashboard always has non-empty rows:
  //  - 20 unmatched rows with parsed season/episode missing
  //  - 20 matched-but-mismatched (parsed_season=2, encoded episode != caption)
  //  - 20 cleanly matched SxxPyEzz rows (regression coverage for S02P2E01)
  const ingestRows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < E2E_INGEST_ROWS; i++) {
    const bucket = Math.floor(i / 20); // 0,1,2
    const channel = E2E_CHANNELS[i % E2E_CHANNELS.length];
    const title = E2E_TITLES[i % E2E_TITLES.length];
    const base = {
      id: `e2e-ingest-${String(i).padStart(3, "0")}`,
      channel_id: channel.id,
      telegram_channel_id: channel.telegram_id,
      telegram_message_id: 1_000_000 + i,
      caption: null as string | null,
      file_name: null as string | null,
      mime_type: "video/mp4",
      file_size: 500_000_000 + i,
      parsed_title: title.title,
      parsed_category: "series",
      created_at: new Date(now - i * 60_000).toISOString(),
    };
    if (bucket === 0) {
      ingestRows.push({
        ...base,
        caption: `Random release pack ${i}`,
        file_name: `release-${i}.mkv`,
        match_status: "unmatched",
        matched_title_id: null,
        parsed_season: null,
        parsed_episode: null,
      });
    } else if (bucket === 1) {
      // Mismatched: parsed indicates S02P2E01 (encoded = 201) but the
      // currently-stored parsed_episode is wrong — drives the audit's
      // "mismatch only" filter.
      ingestRows.push({
        ...base,
        caption: `${title.title} S02P2E${String((i % 10) + 1).padStart(2, "0")} 1080p`,
        file_name: `${title.slug}.S02P2E${String((i % 10) + 1).padStart(2, "0")}.mkv`,
        match_status: "matched",
        matched_title_id: title.id,
        parsed_season: 2,
        parsed_episode: (i % 10) + 1, // wrong: should be 200 + (i%10)+1
      });
    } else {
      ingestRows.push({
        ...base,
        caption: `${title.title} S02P2E${String((i % 10) + 1).padStart(2, "0")} 1080p`,
        file_name: `${title.slug}.S02P2E${String((i % 10) + 1).padStart(2, "0")}.mkv`,
        match_status: "matched",
        matched_title_id: title.id,
        parsed_season: 2,
        parsed_episode: 200 + ((i % 10) + 1), // correctly encoded
      });
    }
  }
  {
    const { error } = await supabase.from("telegram_ingest").upsert(ingestRows, { onConflict: "id" });
    if (error) throw error;
    console.log(`seeded ${ingestRows.length} telegram_ingest rows`);
  }

  console.log("\nE2E shortener + audit seed complete:");
  console.log(`  providers          : ${E2E_SHORTENER_PROVIDERS.length}`);
  console.log(`  health samples     : ${samples.length}`);
  console.log(`  channels           : ${E2E_CHANNELS.length}`);
  console.log(`  titles             : ${E2E_TITLES.length}`);
  console.log(`  ingest rows        : ${ingestRows.length}`);
}

// Allow being imported as a module (for the Playwright specs that need
// the shared constants) without auto-running.
if (import.meta.main) {
  await main();
}
