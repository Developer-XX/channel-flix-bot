import { describe, it, expect, vi } from "vitest";
import {
  waitForSession,
  classifyGoogleFailure,
  handleGoogleSignIn,
  type GetSessionResult,
  type MinimalSession,
} from "./auth-google";

const session: MinimalSession = {
  access_token: "a",
  refresh_token: "r",
  user: { email: "user@example.com" },
};

const ok = (s: MinimalSession | null): GetSessionResult => ({ data: { session: s }, error: null });
const err = (message: string): GetSessionResult => ({ data: { session: null }, error: { message } });

describe("waitForSession polling", () => {
  it("returns the session on the first poll when available", async () => {
    const getSession = vi.fn().mockResolvedValue(ok(session));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const res = await waitForSession(getSession, { sleep, timeoutMs: 1000 });
    expect(res.session).toEqual(session);
    expect(res.error).toBeNull();
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("polls multiple times until a session appears", async () => {
    const getSession = vi
      .fn<[], Promise<GetSessionResult>>()
      .mockResolvedValueOnce(ok(null))
      .mockResolvedValueOnce(ok(null))
      .mockResolvedValueOnce(ok(session));
    const sleep = vi.fn().mockResolvedValue(undefined);
    let t = 0;
    const now = () => (t += 50);

    const res = await waitForSession(getSession, { sleep, timeoutMs: 1000, intervalMs: 50, now });
    expect(res.session).toEqual(session);
    expect(getSession).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(50);
  });

  it("returns null/null when the timeout elapses with no session", async () => {
    const getSession = vi.fn().mockResolvedValue(ok(null));
    const sleep = vi.fn().mockResolvedValue(undefined);
    let t = 0;
    // Each `now()` jumps 200ms — so after a few polls we exceed the 500ms budget.
    const now = () => (t += 200);

    const res = await waitForSession(getSession, { sleep, timeoutMs: 500, intervalMs: 100, now });
    expect(res.session).toBeNull();
    expect(res.error).toBeNull();
    expect(getSession.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("surfaces a getSession error immediately as a structured Error", async () => {
    const getSession = vi.fn().mockResolvedValue(err("boom"));
    const res = await waitForSession(getSession, { sleep: vi.fn(), timeoutMs: 1000 });
    expect(res.session).toBeNull();
    expect(res.error).toBeInstanceOf(Error);
    expect(res.error?.message).toBe("boom");
  });
});

describe("classifyGoogleFailure", () => {
  it.each([
    ["Network request failed", "network_error"],
    ["fetch error while contacting google", "network_error"],
    ["token is invalid", "invalid_token"],
    ["session has expired", "expired_session"],
    ["unexpected provider state", "provider_error"],
    ["", "provider_error"],
  ])("%s → %s", (msg, expected) => {
    expect(classifyGoogleFailure(msg)).toBe(expected);
  });

  it("accepts Error-like objects", () => {
    expect(classifyGoogleFailure({ message: "Network unreachable" })).toBe("network_error");
  });
});

describe("handleGoogleSignIn outcomes (session-missing UI + failure_reason)", () => {
  it("returns 'sessionMissing' with failure_reason=session_missing when getSession never returns a session", async () => {
    const outcome = await handleGoogleSignIn({
      signInWithOAuth: async () => ({ error: null, redirected: false }),
      getSession: async () => ok(null),
      waitForSessionOptions: { timeoutMs: 0, sleep: vi.fn() },
    });
    expect(outcome.kind).toBe("sessionMissing");
    if (outcome.kind === "sessionMissing") {
      expect(outcome.failureReason).toBe("session_missing");
      expect(outcome.message).toMatch(/not persisted/i);
    }
  });

  it("returns 'sessionMissing' with failure_reason=provider_error when getSession errors", async () => {
    const outcome = await handleGoogleSignIn({
      signInWithOAuth: async () => ({ error: null, redirected: false }),
      getSession: async () => err("getSession exploded"),
      waitForSessionOptions: { timeoutMs: 0, sleep: vi.fn() },
    });
    expect(outcome.kind).toBe("sessionMissing");
    if (outcome.kind === "sessionMissing") {
      expect(outcome.failureReason).toBe("provider_error");
      expect(outcome.message).toBe("getSession exploded");
    }
  });

  it("returns 'providerError' with a structured failure_reason when the OAuth call reports an error", async () => {
    const outcome = await handleGoogleSignIn({
      signInWithOAuth: async () => ({ error: { message: "Network request failed" } }),
      getSession: async () => ok(null),
    });
    expect(outcome.kind).toBe("providerError");
    if (outcome.kind === "providerError") {
      expect(outcome.failureReason).toBe("network_error");
      expect(outcome.message).toBe("Network request failed");
    }
  });

  it("returns 'providerError' when the OAuth call throws", async () => {
    const outcome = await handleGoogleSignIn({
      signInWithOAuth: async () => {
        throw new Error("token malformed");
      },
      getSession: async () => ok(null),
    });
    expect(outcome.kind).toBe("providerError");
    if (outcome.kind === "providerError") {
      expect(outcome.failureReason).toBe("invalid_token");
    }
  });

  it("returns 'redirected' without invoking getSession when the provider redirected the page", async () => {
    const getSession = vi.fn();
    const outcome = await handleGoogleSignIn({
      signInWithOAuth: async () => ({ redirected: true }),
      getSession: getSession as never,
    });
    expect(outcome.kind).toBe("redirected");
    expect(getSession).not.toHaveBeenCalled();
  });

  it("returns 'success' with the user's email when a session is persisted", async () => {
    const outcome = await handleGoogleSignIn({
      signInWithOAuth: async () => ({ error: null, redirected: false }),
      getSession: async () => ok(session),
    });
    expect(outcome.kind).toBe("success");
    if (outcome.kind === "success") {
      expect(outcome.email).toBe("user@example.com");
      expect(outcome.session).toEqual(session);
    }
  });
});
