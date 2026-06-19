/**
 * Unit tests for the 24h per-user interstitial cap (login placement).
 * Tests the pure `evaluateInterstitialEligibility` helper with a stubbed
 * Supabase query builder.
 */
import { describe, it, expect, vi } from "vitest";
import { evaluateInterstitialEligibility } from "@/lib/interstitial-eligibility.functions";

function stubSupabase(rows: { created_at: string }[]) {
  const limit = vi.fn().mockResolvedValue({ data: rows, error: null });
  const order = vi.fn().mockReturnValue({ limit });
  const gte = vi.fn().mockReturnValue({ order });
  const eq2 = vi.fn().mockReturnValue({ gte });
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
  const select = vi.fn().mockReturnValue({ eq: eq1 });
  const from = vi.fn().mockReturnValue({ select });
  return { supabase: { from }, select, eq1, eq2, gte };
}

describe("evaluateInterstitialEligibility", () => {
  it("returns eligible for non-capped placements (no DB query)", async () => {
    const { supabase, select } = stubSupabase([]);
    const res = await evaluateInterstitialEligibility(supabase, "user-123", "interstitial_periodic");
    expect(res).toEqual({ eligible: true, nextAllowedAt: null });
    expect(select).not.toHaveBeenCalled();
  });

  it("returns ineligible for login when a view exists within 24h", async () => {
    const now = Date.now();
    const recent = new Date(now - 60 * 60_000).toISOString(); // 1h ago
    const { supabase } = stubSupabase([{ created_at: recent }]);
    const res = await evaluateInterstitialEligibility(supabase, "user-123", "interstitial_login", now);
    expect(res.eligible).toBe(false);
    expect(res.nextAllowedAt).toBeTruthy();
    // Next allowed = recent + 24h
    const expected = new Date(new Date(recent).getTime() + 24 * 3600_000).toISOString();
    expect(res.nextAllowedAt).toBe(expected);
  });

  it("returns eligible for login when no recent rows exist (>24h ago)", async () => {
    // DB filter excludes anything older than 24h, so empty rows[] == eligible.
    const { supabase } = stubSupabase([]);
    const res = await evaluateInterstitialEligibility(supabase, "user-123", "interstitial_login");
    expect(res).toEqual({ eligible: true, nextAllowedAt: null });
  });

  it("scopes the query to the calling user_id and placement", async () => {
    const { supabase, eq1, eq2 } = stubSupabase([]);
    await evaluateInterstitialEligibility(supabase, "user-xyz", "interstitial_login");
    expect(eq1).toHaveBeenCalledWith("user_id", "user-xyz");
    expect(eq2).toHaveBeenCalledWith("placement", "interstitial_login");
  });
});
