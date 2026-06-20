import { describe, it, expect } from "vitest";
import {
  aggregateShortenerSamples,
  buildShortenerReport,
  type ShortenerHealthSample,
  type ShortenerConfigRow,
} from "@/lib/shortener-stats";

/**
 * Performance-regression guard for the shortener stats aggregation.
 *
 * The production query (`getShortenerReport`) selects up to ~30 days of
 * `shortener_health_log` rows and feeds them through
 * `aggregateShortenerSamples` + `buildShortenerReport`. At the expected
 * scale (4 providers × ~60 samples = 240 rows, with an upper bound
 * around 4 × 30 × 24 ≈ 2880 rows if a row is logged every hour for a
 * month) the pure JS aggregation must stay well under a tight budget so
 * the admin dashboard never blocks on the in-process work.
 *
 * Budget rationale: 25ms is ~10× the typical observed runtime on the
 * smallest preview instance (≈2ms locally) — generous enough to absorb
 * GC/cold-start variance in CI while still catching an O(n²) regression
 * that would multiply runtime into the hundreds of ms.
 */

const PROVIDERS = ["nanolinks", "adrinolinks", "shortener-c", "shortener-d"];

function buildSamples(rowsPerProvider: number): ShortenerHealthSample[] {
  const now = Date.now();
  const out: ShortenerHealthSample[] = [];
  for (const provider of PROVIDERS) {
    for (let i = 0; i < rowsPerProvider; i++) {
      out.push({
        provider,
        ok: i % 5 !== 0,
        latency_ms: 200 + (i % 7) * 50,
        checked_at: new Date(now - i * 60_000).toISOString(),
        error: i % 5 === 0 ? "perf: simulated 502" : null,
      });
    }
  }
  return out;
}

function timeIt(fn: () => unknown, iterations = 5): number {
  let best = Infinity;
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    const dt = performance.now() - start;
    if (dt < best) best = dt;
  }
  return best;
}

/**
 * Both budgets are configurable via env vars so CI runners (which are
 * often slower / noisier than local dev) can relax the threshold
 * without code edits. Defaults match the original tight budget.
 *
 *   SHORTENER_PERF_AGG_MS    — budget for aggregateShortenerSamples (default 25)
 *   SHORTENER_PERF_REPORT_MS — budget for buildShortenerReport       (default 50)
 */
const AGG_BUDGET_MS = Number(process.env.SHORTENER_PERF_AGG_MS ?? 25);
const REPORT_BUDGET_MS = Number(process.env.SHORTENER_PERF_REPORT_MS ?? 50);

describe("shortener stats — perf regression", () => {
  it(`aggregateShortenerSamples processes 240 rows under ${AGG_BUDGET_MS}ms (best-of-5)`, () => {
    const samples = buildSamples(60); // matches the seed script
    const best = timeIt(() => aggregateShortenerSamples(samples));
    expect(samples.length).toBe(240);
    expect(
      best,
      `aggregateShortenerSamples took ${best.toFixed(2)}ms — budget is ${AGG_BUDGET_MS}ms`,
    ).toBeLessThan(AGG_BUDGET_MS);
  });

  it(`buildShortenerReport processes a 30-day worst-case dataset under ${REPORT_BUDGET_MS}ms`, () => {
    // Worst-case: one log row per provider per hour for 30 days.
    const samples = buildSamples(30 * 24); // 2880 rows total
    const configs: ShortenerConfigRow[] = PROVIDERS.map((p, i) => ({
      provider: p,
      enabled: true,
      priority: 100 + i,
      weight: 1,
    }));
    const best = timeIt(() => buildShortenerReport(configs, samples));
    expect(samples.length).toBe(2880);
    expect(
      best,
      `buildShortenerReport took ${best.toFixed(2)}ms — budget is ${REPORT_BUDGET_MS}ms`,
    ).toBeLessThan(REPORT_BUDGET_MS);
  });
});
