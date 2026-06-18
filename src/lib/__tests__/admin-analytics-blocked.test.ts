/**
 * Regression test: the admin analytics aggregate (shape used by the admin
 * dashboard) includes a `blockedBrowsing` block with publicBrowsingEnabled,
 * date-window counts, byReason breakdown, and recent rows — and the breakdown
 * correctly reflects rows we just inserted via the RPC.
 *
 * We exercise the *aggregation logic* directly against the DB (the server
 * function is admin-gated; we mirror its query shape here using the
 * service-role client to avoid needing an admin session in vitest).
 */
import { describe, it, expect, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";

const URL_ =
  process.env.SUPABASE_URL ??
  process.env.VITE_SUPABASE_URL ??
  "https://ehjkzvddtgljntwwasui.supabase.co";
const ANON = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasKeys = !!ANON && !!SERVICE;

describe.skipIf(!hasKeys)("admin analytics: blockedBrowsing block", () => {
  const admin = createClient(URL_, SERVICE!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anon = createClient(URL_, ANON!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const REASON = `regtest_admin_${Date.now()}`;

  afterAll(async () => {
    await admin.from("blocked_browsing_log").delete().eq("reason", REASON);
  });

  it("byReason breakdown surfaces inserted reasons with accurate counts", async () => {
    for (let i = 0; i < 4; i++) {
      await anon.rpc("log_blocked_browsing", {
        _reason: REASON,
        _slug: "x",
        _path: "/title/x",
        _user_agent: "vitest",
      });
    }

    const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const { data } = await admin
      .from("blocked_browsing_log")
      .select("reason")
      .gte("created_at", since30)
      .limit(5000);
    const counts = new Map<string, number>();
    for (const row of (data ?? []) as Array<{ reason: string }>) {
      counts.set(row.reason, (counts.get(row.reason) ?? 0) + 1);
    }
    expect((counts.get(REASON) ?? 0) >= 4).toBe(true);
  });

  it("recent feed orders DESC by created_at and includes new rows", async () => {
    const { data } = await admin
      .from("blocked_browsing_log")
      .select("id, created_at, reason")
      .order("created_at", { ascending: false })
      .limit(25);
    expect(data).toBeTruthy();
    expect((data ?? []).some((r) => r.reason === REASON)).toBe(true);
    // Confirm DESC ordering.
    const times = (data ?? []).map((r) => new Date(r.created_at as string).getTime());
    for (let i = 1; i < times.length; i++) {
      expect(times[i - 1] >= times[i]).toBe(true);
    }
  });

  it("is_public_browsing_enabled RPC returns a boolean", async () => {
    const { data, error } = await admin.rpc("is_public_browsing_enabled");
    expect(error).toBeNull();
    expect(typeof data).toBe("boolean");
  });
});
