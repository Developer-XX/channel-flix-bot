/**
 * Regression tests for blocked-browsing analytics:
 *   - log_blocked_browsing RPC writes the expected fields (reason, slug, path,
 *     toggle state) and is callable as anon.
 *   - Forced block reasons surface correctly in the by-reason breakdown.
 *   - Date-window counts (today / 7d / 30d) increment as expected.
 *   - The 600/min rate-limit is enforced and excess writes are dropped silently.
 *
 * Skips when service-role + publishable keys are unavailable.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";

const URL_ =
  process.env.SUPABASE_URL ??
  process.env.VITE_SUPABASE_URL ??
  "https://ehjkzvddtgljntwwasui.supabase.co";
const ANON = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasKeys = !!ANON && !!SERVICE;

describe.skipIf(!hasKeys)("blocked browsing analytics", () => {
  const anon = createClient(URL_, ANON!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(URL_, SERVICE!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const REASON_FORCED = `regtest_forced_${Date.now()}`;
  const REASON_TOGGLE_OFF = `regtest_toggle_off_${Date.now()}`;
  const insertedIds: string[] = [];

  afterAll(async () => {
    // Best-effort cleanup so dashboards aren't polluted.
    await admin
      .from("blocked_browsing_log")
      .delete()
      .in("reason", [REASON_FORCED, REASON_TOGGLE_OFF, "regtest_ratelimit"]);
  });

  it("RPC inserts rows with reason / slug / path / toggle_on", async () => {
    const r = await anon.rpc("log_blocked_browsing", {
      _reason: REASON_FORCED,
      _slug: "test-slug",
      _path: "/title/test-slug",
      _user_agent: "vitest",
    });
    expect(r.error).toBeNull();

    const { data, error } = await admin
      .from("blocked_browsing_log")
      .select("id, reason, slug, path, toggle_on")
      .eq("reason", REASON_FORCED)
      .order("created_at", { ascending: false })
      .limit(1);
    expect(error).toBeNull();
    expect(data && data.length).toBe(1);
    const row = data![0];
    insertedIds.push(row.id);
    expect(row.reason).toBe(REASON_FORCED);
    expect(row.slug).toBe("test-slug");
    expect(row.path).toBe("/title/test-slug");
    expect(typeof row.toggle_on).toBe("boolean");
  });

  it("captures toggle state at write time (toggle OFF → toggle_on=false)", async () => {
    await admin
      .from("app_settings")
      .upsert(
        { key: "PUBLIC_BROWSING_ENABLED", value: "false", is_secret: false },
        { onConflict: "key" },
      );

    const r = await anon.rpc("log_blocked_browsing", {
      _reason: REASON_TOGGLE_OFF,
      _slug: "off-slug",
      _path: "/title/off-slug",
      _user_agent: "vitest",
    });
    expect(r.error).toBeNull();

    const { data } = await admin
      .from("blocked_browsing_log")
      .select("toggle_on")
      .eq("reason", REASON_TOGGLE_OFF)
      .limit(1);
    expect(data?.[0]?.toggle_on).toBe(false);

    // Restore.
    await admin
      .from("app_settings")
      .upsert(
        { key: "PUBLIC_BROWSING_ENABLED", value: "true", is_secret: false },
        { onConflict: "key" },
      );
  });

  it("by-reason breakdown and date-window counts increment", async () => {
    // Baseline.
    const before = await admin
      .from("blocked_browsing_log")
      .select("id", { count: "exact", head: true })
      .eq("reason", REASON_FORCED);
    const baseline = before.count ?? 0;

    // 3 more inserts.
    for (let i = 0; i < 3; i++) {
      const r = await anon.rpc("log_blocked_browsing", {
        _reason: REASON_FORCED,
        _slug: `s${i}`,
        _path: `/title/s${i}`,
        _user_agent: "vitest",
      });
      expect(r.error).toBeNull();
    }

    const after = await admin
      .from("blocked_browsing_log")
      .select("id", { count: "exact", head: true })
      .eq("reason", REASON_FORCED);
    expect((after.count ?? 0) - baseline).toBe(3);

    // Today window must include these inserts.
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const today = await admin
      .from("blocked_browsing_log")
      .select("id", { count: "exact", head: true })
      .eq("reason", REASON_FORCED)
      .gte("created_at", todayStart.toISOString());
    expect((today.count ?? 0) >= 3).toBe(true);
  });

  it("rate-limit (600/min) drops excess writes gracefully (no error)", async () => {
    // Pre-seed > 600 rows in the last minute so the next anon call hits the cap.
    const seedRows = Array.from({ length: 650 }, () => ({
      reason: "regtest_ratelimit",
      slug: "seed",
      path: "/title/seed",
      toggle_on: true,
      user_agent: "vitest-seed",
    }));
    // Bulk insert via service role to fill the 1-minute window.
    const seed = await admin.from("blocked_browsing_log").insert(seedRows);
    expect(seed.error).toBeNull();

    // Snapshot count right after seeding.
    const since = new Date(Date.now() - 60_000).toISOString();
    const before = await admin
      .from("blocked_browsing_log")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since);
    const baseline = before.count ?? 0;
    expect(baseline > 600).toBe(true);

    // Now fire a burst as anon — each should return gracefully and be dropped.
    const burst = 10;
    const results = await Promise.all(
      Array.from({ length: burst }, (_, i) =>
        anon.rpc("log_blocked_browsing", {
          _reason: "regtest_ratelimit",
          _slug: `b${i}`,
          _path: `/title/b${i}`,
          _user_agent: "vitest-burst",
        }),
      ),
    );
    for (const r of results) {
      expect(r.error).toBeNull(); // function returns silently when capped
    }

    // Confirm the burst rows were NOT inserted (rate-limit enforced).
    const after = await admin
      .from("blocked_browsing_log")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since)
      .eq("user_agent", "vitest-burst");
    expect(after.count ?? 0).toBe(0);
  });
});
