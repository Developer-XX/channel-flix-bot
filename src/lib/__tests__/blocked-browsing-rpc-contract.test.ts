/**
 * Contract tests for the blocked-browsing RPC surface.
 *
 * Verifies:
 *  - log_blocked_browsing rejects malformed inputs with a structured PostgREST
 *    error (code/message/details/hint) — never silently swallows them.
 *  - is_public_browsing_enabled is anon-callable and returns a boolean.
 *  - Anon callers cannot SELECT blocked_browsing_log (admin-only table).
 *  - Anon callers cannot mutate app_settings.
 *
 * Skips gracefully when keys aren't present.
 */
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const URL_ =
  process.env.SUPABASE_URL ??
  process.env.VITE_SUPABASE_URL ??
  "https://ehjkzvddtgljntwwasui.supabase.co";
const ANON = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

describe.skipIf(!ANON)("blocked-browsing RPC contract", () => {
  const anon = createClient(URL_, ANON!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  it("log_blocked_browsing(null reason) returns a structured error", async () => {
    const r = await anon.rpc("log_blocked_browsing", {
      _reason: null as unknown as string,
    });
    expect(r.error).not.toBeNull();
    // PostgREST error envelope: { message, code, details, hint }
    expect(typeof r.error!.message).toBe("string");
    expect(r.error!.message.length).toBeGreaterThan(0);
  });

  it("log_blocked_browsing(oversized reason >64 chars) returns a structured error", async () => {
    const r = await anon.rpc("log_blocked_browsing", {
      _reason: "x".repeat(65),
      _slug: "s",
      _path: "/p",
      _user_agent: "vitest",
    });
    expect(r.error).not.toBeNull();
    expect(r.error!.message.toLowerCase()).toContain("invalid reason");
  });

  it("log_blocked_browsing(valid) returns null error", async () => {
    const r = await anon.rpc("log_blocked_browsing", {
      _reason: "contract_ok",
      _slug: "s",
      _path: "/p",
      _user_agent: "vitest",
    });
    expect(r.error).toBeNull();
  });

  it("is_public_browsing_enabled is anon-callable and returns boolean", async () => {
    const r = await anon.rpc("is_public_browsing_enabled");
    expect(r.error).toBeNull();
    expect(typeof r.data).toBe("boolean");
  });

  it("anon CANNOT SELECT blocked_browsing_log (admin-only)", async () => {
    const r = await anon.from("blocked_browsing_log").select("id").limit(1);
    // Either empty (RLS filtered) or an explicit permission error — both are acceptable.
    if (r.error) {
      expect(r.error.code === "42501" || /permission|denied/i.test(r.error.message)).toBe(true);
    } else {
      expect(r.data ?? []).toEqual([]);
    }
  });

  it("anon CANNOT mutate app_settings (PUBLIC_BROWSING_ENABLED toggle is admin-only)", async () => {
    const r = await anon
      .from("app_settings")
      .upsert(
        { key: "PUBLIC_BROWSING_ENABLED", value: "false", is_secret: false },
        { onConflict: "key" },
      );
    expect(r.error).not.toBeNull();
  });

  it("HTTP responses carry standard PostgREST headers", async () => {
    // Direct fetch so we can inspect headers (rate-limit + content-type contract).
    const res = await fetch(`${URL_}/rest/v1/rpc/is_public_browsing_enabled`, {
      method: "POST",
      headers: {
        apikey: ANON!,
        Authorization: `Bearer ${ANON!}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("application/json");
  });
});
