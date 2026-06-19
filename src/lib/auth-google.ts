// Pure, dependency-injected helpers for the Google sign-in flow.
// Extracted so they can be unit-tested without rendering the auth route.

export type AuthFailureReason =
  | "invalid_token"
  | "expired_session"
  | "network_error"
  | "provider_error"
  | "session_missing";

export interface MinimalSession {
  access_token: string;
  refresh_token: string;
  user: { email?: string | null };
}

export interface GetSessionResult {
  data: { session: MinimalSession | null };
  error: { message: string } | null;
}

export type GetSessionFn = () => Promise<GetSessionResult>;
export type SleepFn = (ms: number) => Promise<void>;
export type NowFn = () => number;

/**
 * Poll getSession() until it returns a session, an error, or the timeout
 * elapses. Returns a discriminated result so callers can distinguish
 * "session missing" from "provider error".
 */
export async function waitForSession(
  getSession: GetSessionFn,
  options: {
    timeoutMs?: number;
    intervalMs?: number;
    sleep?: SleepFn;
    now?: NowFn;
  } = {},
): Promise<{ session: MinimalSession | null; error: Error | null }> {
  const timeoutMs = options.timeoutMs ?? 3000;
  const intervalMs = options.intervalMs ?? 150;
  const sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = options.now ?? (() => Date.now());

  const deadline = now() + timeoutMs;
  // Always make at least one attempt, even if timeoutMs is 0.
  do {
    const { data, error } = await getSession();
    if (error) return { session: null, error: new Error(error.message) };
    if (data.session) return { session: data.session, error: null };
    if (now() >= deadline) break;
    await sleep(intervalMs);
  } while (now() < deadline);

  return { session: null, error: null };
}

/**
 * Map a Google/OAuth provider error message to a structured failure_reason
 * so analytics dashboards can group sign-in failures consistently.
 */
export function classifyGoogleFailure(messageOrError: unknown): AuthFailureReason {
  const msg =
    typeof messageOrError === "string"
      ? messageOrError
      : (messageOrError as { message?: string })?.message ?? String(messageOrError ?? "");
  const lower = msg.toLowerCase();
  if (/network|fetch|offline/.test(lower)) return "network_error";
  if (/expired|expir/.test(lower)) return "expired_session";
  if (/token/.test(lower)) return "invalid_token";
  return "provider_error";
}

export type GoogleSignInOutcome =
  | { kind: "redirected" }
  | { kind: "success"; email?: string; session: MinimalSession }
  | { kind: "providerError"; failureReason: AuthFailureReason; message: string }
  | { kind: "sessionMissing"; failureReason: "session_missing" | "provider_error"; message: string };

export interface OAuthResult {
  error?: { message?: string } | null;
  redirected?: boolean;
}

export interface HandleGoogleSignInDeps {
  signInWithOAuth: () => Promise<OAuthResult>;
  getSession: GetSessionFn;
  waitForSessionOptions?: Parameters<typeof waitForSession>[1];
}

/**
 * Orchestrates the Google sign-in flow and returns a typed outcome.
 * Side effects (logging, toast, redirect) are the caller's responsibility,
 * which keeps this function trivially testable.
 */
export async function handleGoogleSignIn(deps: HandleGoogleSignInDeps): Promise<GoogleSignInOutcome> {
  let result: OAuthResult;
  try {
    result = await deps.signInWithOAuth();
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    return { kind: "providerError", failureReason: classifyGoogleFailure(msg), message: msg };
  }

  if (result.error) {
    const msg = result.error.message ?? "OAuth provider error";
    return { kind: "providerError", failureReason: classifyGoogleFailure(msg), message: msg };
  }
  if (result.redirected) return { kind: "redirected" };

  const { session, error } = await waitForSession(deps.getSession, deps.waitForSessionOptions);
  if (error) {
    return { kind: "sessionMissing", failureReason: "provider_error", message: error.message };
  }
  if (!session) {
    return {
      kind: "sessionMissing",
      failureReason: "session_missing",
      message: "Session was not persisted after OAuth",
    };
  }
  return { kind: "success", email: session.user.email ?? undefined, session };
}
