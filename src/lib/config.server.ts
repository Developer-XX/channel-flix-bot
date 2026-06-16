import process from "node:process";

// Server-only config. Read env INSIDE functions (Workers binds env per-request).

export function getServerConfig() {
  return {
    nodeEnv: process.env.NODE_ENV,
  };
}

/**
 * Verification attempt-cap config — tunable without code changes.
 *   VERIFICATION_MAX_PER_HOUR  (default 30)
 *   VERIFICATION_WINDOW_MINUTES (default 60)
 */
export function getVerificationConfig() {
  const max = Number(process.env.VERIFICATION_MAX_PER_HOUR ?? 30);
  const windowMin = Number(process.env.VERIFICATION_WINDOW_MINUTES ?? 60);
  return {
    maxPerWindow: Number.isFinite(max) && max > 0 ? Math.floor(max) : 30,
    windowMs: (Number.isFinite(windowMin) && windowMin > 0 ? windowMin : 60) * 60 * 1000,
  };
}
