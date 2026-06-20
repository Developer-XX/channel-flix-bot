import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  aggregateShortenerSamples,
  buildShortenerReport,
  type ShortenerHealthSample,
} from "../shortener-stats";

const NOW = new Date("2026-06-20T12:00:00.000Z");
const day = (n: number) =>
  new Date(NOW.getTime() - n * 86400_000).toISOString();

const sampleSet: ShortenerHealthSample[] = [
  // adrinolinks — 7d window
  { provider: "adrinolinks", ok: true, latency_ms: 100, checked_at: day(1), error: null },
  { provider: "adrinolinks", ok: true, latency_ms: 300, checked_at: day(2), error: null },
  { provider: "adrinolinks", ok: false, latency_ms: 500, checked_at: day(3), error: "boom" },
  // adrinolinks — outside 7d but within 30d
  { provider: "adrinolinks", ok: true, latency_ms: 200, checked_at: day(15), error: null },
  // nanolinks — only old
  { provider: "nanolinks", ok: false, latency_ms: null, checked_at: day(20), error: "timeout" },
];

describe("aggregateShortenerSamples (schema contract: checked_at)", () => {
  it("splits samples into 7d and 30d windows using checked_at", () => {
    const stats = aggregateShortenerSamples(sampleSet, NOW);
    const adri = stats.get("adrinolinks")!;
    expect(adri.total7).toBe(3);
    expect(adri.ok7).toBe(2);
    expect(adri.total30).toBe(4);
    expect(adri.ok30).toBe(3);
    expect(adri.avgLatency7).toBeCloseTo((100 + 300 + 500) / 3, 5);
    expect(adri.avgLatency30).toBeCloseTo((100 + 300 + 500 + 200) / 4, 5);
    expect(adri.lastFailure).toEqual({ at: day(3), error: "boom" });

    const nano = stats.get("nanolinks")!;
    expect(nano.total7).toBe(0); // older than 7 days
    expect(nano.total30).toBe(1);
    expect(nano.lastFailure?.error).toBe("timeout");
  });

  it("buildShortenerReport computes success rates and attempt counts", () => {
    const rows = buildShortenerReport(
      [
        { provider: "adrinolinks", enabled: true, priority: 10, weight: 1 },
        { provider: "nanolinks", enabled: true, priority: 20, weight: 1 },
        { provider: "no-data", enabled: false, priority: 30, weight: 1 },
      ],
      sampleSet,
      NOW,
    );
    const byProv = Object.fromEntries(rows.map((r) => [r.provider, r]));

    expect(byProv.adrinolinks.attempts7).toBe(3);
    expect(byProv.adrinolinks.attempts30).toBe(4);
    expect(byProv.adrinolinks.successRate7).toBe(66.7); // 2/3
    expect(byProv.adrinolinks.successRate30).toBe(75);

    expect(byProv.nanolinks.attempts7).toBe(0);
    expect(byProv.nanolinks.attempts30).toBe(1);
    expect(byProv.nanolinks.successRate7).toBeNull();
    expect(byProv.nanolinks.successRate30).toBe(0);

    // No samples at all → nulls, not zeros, so the UI shows "—".
    expect(byProv["no-data"].attempts7).toBe(0);
    expect(byProv["no-data"].successRate7).toBeNull();
    expect(byProv["no-data"].successRate30).toBeNull();
  });

  it("zero samples returns nulls for rates (not NaN, not 0)", () => {
    const rows = buildShortenerReport(
      [{ provider: "x", enabled: true, priority: 1, weight: 1 }],
      [],
      NOW,
    );
    expect(rows[0].successRate7).toBeNull();
    expect(rows[0].successRate30).toBeNull();
    expect(rows[0].attempts7).toBe(0);
    expect(rows[0].attempts30).toBe(0);
  });
});

describe("shortener-admin.functions.ts queries the correct column", () => {
  // Regression: the bug was selecting `created_at` from shortener_health_log,
  // which doesn't exist (the column is `checked_at`). PostgREST silently
  // returned no rows and the admin UI rendered all zeros / dashes.
  it("never references created_at on shortener_health_log", () => {
    const src = readFileSync(
      join(__dirname, "..", "shortener-admin.functions.ts"),
      "utf8",
    );
    // Strip comments so the in-file regression note doesn't trigger.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/shortener_health_log/);
    expect(code).toMatch(/checked_at/);
    expect(code).not.toMatch(/created_at/);
  });
});
