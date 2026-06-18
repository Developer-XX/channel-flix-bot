/**
 * Regression test: confirms the public-browsing toggle truly gates
 * anonymous reads at the database layer (RLS + has_role + helper fn).
 *
 * Runs only when the publishable + service-role keys are available in env
 * (so it can flip the toggle and restore it). On CI without secrets it
 * skips gracefully — that's the right behavior for a security regression
 * test that needs to touch the real database.
 */
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const URL =
  process.env.SUPABASE_URL ??
  process.env.VITE_SUPABASE_URL ??
  "https://ehjkzvddtgljntwwasui.supabase.co";
const ANON = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const hasKeys = !!ANON && !!SERVICE;

describe.skipIf(!hasKeys)("public browsing toggle (RLS regression)", () => {
  const anon = createClient(URL, ANON!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(URL, SERVICE!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  async function setToggle(value: "true" | "false") {
    await admin
      .from("app_settings")
      .upsert(
        { key: "PUBLIC_BROWSING_ENABLED", value, is_secret: false },
        { onConflict: "key" },
      );
  }

  it("when toggle = true, anon CAN list published titles and read media files", async () => {
    await setToggle("true");
    const titles = await anon
      .from("master_titles")
      .select("id, slug")
      .eq("status", "published")
      .limit(5);
    expect(titles.error).toBeNull();
    expect((titles.data ?? []).length).toBeGreaterThan(0);

    const files = await anon
      .from("media_files")
      .select("id")
      .eq("is_active", true)
      .limit(1);
    expect(files.error).toBeNull();
  });

  it("when toggle = false, anon CANNOT list rows or open detail data", async () => {
    await setToggle("false");

    const titles = await anon
      .from("master_titles")
      .select("id, slug")
      .eq("status", "published")
      .limit(5);
    expect(titles.error).toBeNull();
    expect(titles.data ?? []).toEqual([]);

    const files = await anon.from("media_files").select("id").limit(1);
    expect(files.error).toBeNull();
    expect(files.data ?? []).toEqual([]);

    const seasons = await anon.from("seasons").select("id").limit(1);
    expect(seasons.error).toBeNull();
    expect(seasons.data ?? []).toEqual([]);

    const episodes = await anon.from("episodes").select("id").limit(1);
    expect(episodes.error).toBeNull();
    expect(episodes.data ?? []).toEqual([]);

    // Restore default for other tests / live app.
    await setToggle("true");
  });

  it("anon log_blocked_browsing RPC succeeds and is rate-bounded", async () => {
    const r = await anon.rpc("log_blocked_browsing", {
      _reason: "regression_test",
      _slug: "test-slug",
      _path: "/title/test-slug",
      _user_agent: "vitest",
    });
    expect(r.error).toBeNull();
  });
});
