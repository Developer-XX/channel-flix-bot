// Pure helpers shared by the auth route and server functions.
// Extracted so they can be unit-tested without rendering a route or
// booting the server-function runtime.

/**
 * Only allow same-origin relative paths so a malicious `?redirect=...`
 * value can't bounce a freshly authenticated user to a third-party site.
 */
export function safeRedirect(
  target: string | undefined,
  origin: string = typeof window !== "undefined" ? window.location.origin : "http://localhost",
): string {
  if (!target) return "/";
  try {
    if (target.startsWith("/") && !target.startsWith("//")) return target;
    const url = new URL(target, origin);
    if (url.origin === origin) return url.pathname + url.search + url.hash;
  } catch {
    /* fall through */
  }
  return "/";
}

export type BotProtectionError = {
  status: number;
  code: "bot_detected" | "bot_challenge_failed";
  message: string;
};

/**
 * Honeypot + timing bot check used by the email/password sign-in server fn.
 * Returns a structured error or null if the request looks human.
 *
 * `now` is injected so tests can deterministically exercise the timing
 * branches.
 */
export function botProtection(
  input: { website?: string; startedAt: number },
  now: () => number = Date.now,
): BotProtectionError | null {
  if (input.website?.trim()) {
    return {
      status: 400,
      code: "bot_detected",
      message: "Bot protection check failed. Please reload and try again.",
    };
  }
  const elapsedMs = now() - input.startedAt;
  if ((elapsedMs >= 0 && elapsedMs < 1200) || elapsedMs > 30 * 60 * 1000) {
    return {
      status: 400,
      code: "bot_challenge_failed",
      message: "Security check expired. Please reload and try again.",
    };
  }
  return null;
}
