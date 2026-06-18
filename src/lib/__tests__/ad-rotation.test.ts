import { describe, expect, it } from "vitest";
import { filterScheduledAds, pickAd, type RotationAd } from "@/lib/ad-rotation";

const mk = (over: Partial<RotationAd> & { id: string }): RotationAd => ({
  placement: "homepage_banner",
  sort_order: 0,
  is_active: true,
  starts_at: null,
  ends_at: null,
  ...over,
});

const T = (iso: string) => new Date(iso).getTime();

describe("filterScheduledAds", () => {
  const ads: RotationAd[] = [
    mk({ id: "always" }),
    mk({ id: "future", starts_at: "2030-01-01T00:00:00Z" }),
    mk({ id: "past", ends_at: "2000-01-01T00:00:00Z" }),
    mk({ id: "window", starts_at: "2026-01-01T00:00:00Z", ends_at: "2026-12-31T00:00:00Z" }),
    mk({ id: "inactive", is_active: false }),
  ];

  it("includes only active ads inside their schedule window", () => {
    const out = filterScheduledAds(ads, T("2026-06-18T12:00:00Z")).map((a) => a.id);
    expect(out.sort()).toEqual(["always", "window"]);
  });

  it("excludes future-starting ads before their start", () => {
    const out = filterScheduledAds(ads, T("2025-01-01T00:00:00Z")).map((a) => a.id);
    expect(out).not.toContain("future");
    expect(out).not.toContain("window");
  });

  it("excludes ended ads after end date", () => {
    const out = filterScheduledAds(ads, T("2050-01-01T00:00:00Z")).map((a) => a.id);
    expect(out).not.toContain("past");
    expect(out).not.toContain("window");
  });
});

describe("pickAd", () => {
  it("returns null for empty input", () => {
    expect(pickAd([], "homepage_banner", 0)).toBeNull();
  });

  it("is deterministic within the same minute bucket + placement", () => {
    const ads = [mk({ id: "a", sort_order: 0 }), mk({ id: "b", sort_order: 5 })];
    const t1 = T("2026-06-18T12:34:10Z");
    const t2 = T("2026-06-18T12:34:55Z");
    expect(pickAd(ads, "homepage_banner", t1)?.id).toBe(
      pickAd(ads, "homepage_banner", t2)?.id,
    );
  });

  it("rotates across minute buckets", () => {
    const ads = [
      mk({ id: "a", sort_order: 0 }),
      mk({ id: "b", sort_order: 1 }),
      mk({ id: "c", sort_order: 2 }),
    ];
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const t = T("2026-06-18T12:00:00Z") + i * 60_000;
      seen.add(pickAd(ads, "homepage_banner", t)!.id);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("weights lower sort_order more often", () => {
    const ads = [mk({ id: "lo", sort_order: 0 }), mk({ id: "hi", sort_order: 9 })];
    const counts: Record<string, number> = { lo: 0, hi: 0 };
    for (let i = 0; i < 1000; i++) {
      const t = T("2026-06-18T00:00:00Z") + i * 60_000;
      counts[pickAd(ads, "homepage_banner", t)!.id]++;
    }
    expect(counts.lo).toBeGreaterThan(counts.hi);
  });

  it("different placements bucket independently in the same minute", () => {
    const ads = [
      mk({ id: "a", sort_order: 0 }),
      mk({ id: "b", sort_order: 1 }),
      mk({ id: "c", sort_order: 2 }),
      mk({ id: "d", sort_order: 3 }),
    ];
    const t = T("2026-06-18T12:00:00Z");
    const placements = ["homepage_banner", "between_rows", "title_page", "before_download"];
    const ids = new Set(placements.map((p) => pickAd(ads, p, t)!.id));
    expect(ids.size).toBeGreaterThan(1);
  });

  it("combined: filter then pick respects scheduling end-to-end", () => {
    const ads: RotationAd[] = [
      mk({ id: "expired", sort_order: 0, ends_at: "2020-01-01T00:00:00Z" }),
      mk({ id: "live", sort_order: 1 }),
    ];
    const t = T("2026-06-18T12:00:00Z");
    const filtered = filterScheduledAds(ads, t);
    const pick = pickAd(filtered, "homepage_banner", t);
    expect(pick?.id).toBe("live");
  });
});
