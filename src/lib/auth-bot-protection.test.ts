import { describe, it, expect, vi } from "vitest";
import { safeRedirect, botProtection } from "./auth-bot-protection";
import { handleGoogleSignIn, type GetSessionResult, type MinimalSession } from "./auth-google";

// These tests exercise the seam where a login-required redirect lands the
// user on /auth?redirect=..., the email/password "bot verification" step
// (honeypot + timing) decides whether the request looks human, and the
// Google sign-in flow has to keep working — including its session-missing
// UI path — regardless of how that bot check resolves.

const ok = (s: MinimalSession | null): GetSessionResult => ({ data: { session: s }, error: null });
const session: MinimalSession = {
  access_token: "a",
  refresh_token: "r",
  user: { email: "user@example.com" },
};

const ORIGIN = "https://app.example.com";

describe("login-required redirect handling", () => {
  it("preserves a safe same-origin redirect path", () => {
    expect(safeRedirect("/admin/telegram", ORIGIN)).toBe("/admin/telegram");
    expect(safeRedirect("/admin?tab=files#top", ORIGIN)).toBe("/admin?tab=files#top");
  });

  it("rejects open-redirects to other origins or protocol-relative URLs", () => {
    expect(safeRedirect("//evil.com/steal", ORIGIN)).toBe("/");
    expect(safeRedirect("https://evil.com/steal", ORIGIN)).toBe("/");
    expect(safeRedirect("javascript:alert(1)", ORIGIN)).toBe("/");
  });

  it("falls back to '/' when the target is missing or unparsable", () => {
    expect(safeRedirect(undefined, ORIGIN)).toBe("/");
    expect(safeRedirect("", ORIGIN)).toBe("/");
  });
});

describe("bot verification during email/password sign-in", () => {
  // Pin a deterministic "now" so the timing branches are stable.
  const now = () => 10_000;

  it("flags honeypot fills as bot_detected", () => {
    const err = botProtection({ website: "https://spam.example", startedAt: 0 }, now);
    expect(err).toEqual(
      expect.objectContaining({ code: "bot_detected", status: 400 }),
    );
  });

  it("flags too-fast submissions as bot_challenge_failed", () => {
    const err = botProtection({ website: "", startedAt: 9_500 }, now); // 500ms elapsed
    expect(err?.code).toBe("bot_challenge_failed");
  });

  it("flags stale forms (>30min) as bot_challenge_failed", () => {
    const err = botProtection({ website: "", startedAt: 10_000 - 31 * 60 * 1000 }, now);
    expect(err?.code).toBe("bot_challenge_failed");
  });

  it("returns null for a legitimate human submission", () => {
    const err = botProtection({ website: "", startedAt: 10_000 - 5_000 }, now);
    expect(err).toBeNull();
  });
});

describe("Google session-missing UI is independent of the bot verification", () => {
  // Simulate what the auth route does after a login-required bounce:
  //   1) Server rejects email/password with a bot-protection error.
  //   2) User clicks "Continue with Google".
  //   3) OAuth resolves but the session never lands in storage.
  // The Google flow must still surface a structured session_missing
  // outcome rather than swallowing the error or redirecting blindly.

  it("still returns sessionMissing/session_missing when a prior bot-check failure is in scope", async () => {
    const botCheck = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: "bot_detected", status: 400, message: "Bot protection check failed." },
    });
    const priorAttempt = await botCheck();
    expect(priorAttempt.ok).toBe(false);
    expect(priorAttempt.error.code).toBe("bot_detected");

    const signInWithOAuth = vi.fn().mockResolvedValue({ error: null, redirected: false });
    const getSession = vi.fn().mockResolvedValue(ok(null));

    const outcome = await handleGoogleSignIn({
      signInWithOAuth,
      getSession,
      waitForSessionOptions: { timeoutMs: 0, sleep: vi.fn() },
    });

    expect(outcome.kind).toBe("sessionMissing");
    if (outcome.kind === "sessionMissing") {
      expect(outcome.failureReason).toBe("session_missing");
    }
    // Bot check was never re-invoked by the Google path.
    expect(botCheck).toHaveBeenCalledTimes(1);
    expect(signInWithOAuth).toHaveBeenCalledTimes(1);
  });

  it("propagates a provider-side OAuth error with a structured failure_reason even if the bot-check passed first", async () => {
    const botCheck = vi.fn().mockResolvedValue({ ok: true });
    await botCheck();

    const outcome = await handleGoogleSignIn({
      signInWithOAuth: async () => ({ error: { message: "Network request failed" } }),
      getSession: async () => ok(null),
    });

    expect(outcome.kind).toBe("providerError");
    if (outcome.kind === "providerError") {
      expect(outcome.failureReason).toBe("network_error");
    }
  });

  it("succeeds and would redirect to the originally requested page when the session is persisted after a redirect bounce", async () => {
    const requestedRedirect = "/admin/telegram";
    const safe = safeRedirect(requestedRedirect, ORIGIN);
    expect(safe).toBe(requestedRedirect);

    const outcome = await handleGoogleSignIn({
      signInWithOAuth: async () => ({ error: null, redirected: false }),
      getSession: async () => ok(session),
    });

    expect(outcome.kind).toBe("success");
    if (outcome.kind === "success") {
      expect(outcome.email).toBe("user@example.com");
    }
  });

  it("does not call getSession when the provider performs a full-page redirect (login-required bounce ends the local flow)", async () => {
    const getSession = vi.fn();
    const outcome = await handleGoogleSignIn({
      signInWithOAuth: async () => ({ redirected: true }),
      getSession: getSession as never,
    });
    expect(outcome.kind).toBe("redirected");
    expect(getSession).not.toHaveBeenCalled();
  });
});
