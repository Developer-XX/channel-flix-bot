/**
 * Unit tests for the 24h per-user interstitial cap (login placement).
 * We drive the handler with a stubbed Supabase context so we can control the
 * row history returned by the query and assert eligibility math.
 */
import { describe, it, expect, vi } from "vitest";
import { getInterstitialEligibility, recordInterstitialView } from "@/lib/interstitial-eligibility.functions";

function makeContext(rows: { created_at: string }[]) {
  const gte = vi.fn().mockReturnValue({
    order: vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
    }),
  });
  const eq2 = vi.fn().mockReturnValue({ gte });
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
  const select = vi.fn().mockReturnValue({ eq: eq1 });
  const insert = vi.fn().mockResolvedValue({ data: null, error: null });
  const from = vi.fn().mockReturnValue({ select, insert });
  return {
    ctx: { supabase: { from } as never, userId: "user-123", claims: {} as never },
    insert,
    from,
  };
}

describe("getInterstitialEligibility", () => {
  it("returns eligible for non-capped placements", async () => {
    const { ctx } = makeContext([]);
    // @ts-expect-error invoking the validated/composed handler directly
    const res = await getInterstitialEligibility.__executeServer({
      data: { placement: "interstitial_periodic" },
      context: ctx,
    });
    expect(res.eligible).toBe(true);
  });

  it("returns ineligible for login when last view is within 24h", async () => {
    const recent = new Date(Date.now() - 60 * 60_000).toISOString(); // 1h ago
    const { ctx } = makeContext([{ created_at: recent }]);
    // @ts-expect-error see above
    const res = await getInterstitialEligibility.__executeServer({
      data: { placement: "interstitial_login" },
      context: ctx,
    });
    expect(res.eligible).toBe(false);
    expect(res.nextAllowedAt).toBeTruthy();
  });

  it("returns eligible for login when last view was over 24h ago", async () => {
    // The DB filter excludes anything older than 24h, so an empty rows[]
    // array represents that scenario.
    const { ctx } = makeContext([]);
    // @ts-expect-error see above
    const res = await getInterstitialEligibility.__executeServer({
      data: { placement: "interstitial_login" },
      context: ctx,
    });
    expect(res.eligible).toBe(true);
  });
});

describe("recordInterstitialView", () => {
  it("inserts a row scoped to the calling user", async () => {
    const { ctx, insert } = makeContext([]);
    // @ts-expect-error see above
    const res = await recordInterstitialView.__executeServer({
      data: { placement: "interstitial_login", ad_id: null },
      context: ctx,
    });
    expect(res.ok).toBe(true);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-123", placement: "interstitial_login" }),
    );
  });
});
