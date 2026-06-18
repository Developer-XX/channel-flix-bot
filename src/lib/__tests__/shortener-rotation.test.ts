import { describe, it, expect } from "vitest";
import { pickProviderForBucket, graceRemainingMs } from "@/lib/shortener-rotation";

const SLOT = 12 * 60 * 60 * 1000; // 12h
const T0 = new Date("2026-06-18T00:00:00Z").getTime();

describe("pickProviderForBucket", () => {
  it("returns null when no providers are enabled", () => {
    expect(
      pickProviderForBucket({ enabled: [], userId: "u1", slotMs: SLOT, now: T0, lastProvider: null }),
    ).toBeNull();
  });

  it("returns the only provider when one is enabled", () => {
    expect(
      pickProviderForBucket({ enabled: ["adrinolinks"], userId: "u1", slotMs: SLOT, now: T0, lastProvider: null }),
    ).toBe("adrinolinks");
  });

  it("rotates across consecutive time buckets for the same user", () => {
    const providers = ["adrinolinks", "nanolinks", "arolinks", "linkpays"];
    const u = "user-abc";
    const seen = new Set<string>();
    for (let k = 0; k < 8; k++) {
      const p = pickProviderForBucket({
        enabled: providers, userId: u, slotMs: SLOT, now: T0 + k * SLOT, lastProvider: null,
      });
      seen.add(p!);
    }
    // Hits every provider over 8 slots of 4 providers.
    expect(seen.size).toBe(providers.length);
  });

  it("offsets buckets per user so different users can land on different providers", () => {
    const providers = ["adrinolinks", "nanolinks"];
    const a = pickProviderForBucket({ enabled: providers, userId: "AAA", slotMs: SLOT, now: T0, lastProvider: null });
    let differed = false;
    for (const u of ["BBB", "CCC", "DDD", "EEE", "FFF"]) {
      const p = pickProviderForBucket({ enabled: providers, userId: u, slotMs: SLOT, now: T0, lastProvider: null });
      if (p !== a) { differed = true; break; }
    }
    expect(differed).toBe(true);
  });

  it("skips the immediately-previous provider on a re-mint", () => {
    const providers = ["adrinolinks", "nanolinks"];
    const u = "user-rotate";
    const first = pickProviderForBucket({
      enabled: providers, userId: u, slotMs: SLOT, now: T0, lastProvider: null,
    })!;
    const second = pickProviderForBucket({
      enabled: providers, userId: u, slotMs: SLOT, now: T0, lastProvider: first,
    });
    expect(second).not.toBe(first);
  });

  it("filters unhealthy providers out of the candidate pool", () => {
    const providers = ["adrinolinks", "nanolinks", "arolinks", "linkpays"];
    const healthy = new Set(["nanolinks", "arolinks"]);
    for (let k = 0; k < 12; k++) {
      const p = pickProviderForBucket({
        enabled: providers, userId: "u1", slotMs: SLOT, now: T0 + k * SLOT, lastProvider: null, healthy,
      });
      expect(healthy.has(p!)).toBe(true);
    }
  });

  it("falls back to the raw enabled list if every provider is unhealthy", () => {
    const providers = ["adrinolinks", "nanolinks"];
    const p = pickProviderForBucket({
      enabled: providers, userId: "u1", slotMs: SLOT, now: T0, lastProvider: null, healthy: new Set(),
    });
    expect(providers).toContain(p!);
  });
});

describe("graceRemainingMs (token-verification skip window)", () => {
  it("returns 0 when grace days are zero", () => {
    expect(graceRemainingMs({ createdAt: new Date(T0 - 1000), graceDays: 0, now: T0 })).toBe(0);
  });

  it("returns 0 when the user has no created_at", () => {
    expect(graceRemainingMs({ createdAt: null, graceDays: 7, now: T0 })).toBe(0);
  });

  it("returns >0 when the user is inside the grace window", () => {
    const createdAt = new Date(T0 - 24 * 60 * 60 * 1000); // 1 day ago
    expect(graceRemainingMs({ createdAt, graceDays: 2, now: T0 })).toBeGreaterThan(0);
  });

  it("returns 0 when the grace window has already expired", () => {
    const createdAt = new Date(T0 - 5 * 24 * 60 * 60 * 1000); // 5 days ago
    expect(graceRemainingMs({ createdAt, graceDays: 2, now: T0 })).toBe(0);
  });
});
