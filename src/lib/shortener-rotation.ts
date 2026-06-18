// Pure provider-rotation logic. Extracted so it can be unit-tested without
// touching the database. Used by verification.server.ts.

export type ProviderName = string;

function userPhase(userId: string): number {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * Choose the active provider for a given user, time bucket, and the set of
 * currently-enabled providers. Unhealthy providers can be filtered out via the
 * `healthy` set (when provided). If filtering removes everything, we fall back
 * to the raw enabled list (better to try than to fail closed).
 *
 * - 1 provider → always that one.
 * - N providers → time-bucketed by `slotMs`, offset per-user, with a 1-slot
 *   skip if the candidate equals `lastProvider` (so an immediate re-mint
 *   rotates instead of repeating).
 */
export function pickProviderForBucket(args: {
  enabled: ProviderName[];
  userId: string;
  slotMs: number;
  now: number;
  lastProvider: string | null;
  healthy?: Set<string> | null;
}): ProviderName | null {
  const { enabled, userId, slotMs, now, lastProvider, healthy } = args;
  if (!enabled.length) return null;

  let candidates = enabled;
  if (healthy && healthy.size > 0) {
    const filtered = enabled.filter((p) => healthy.has(p));
    if (filtered.length > 0) candidates = filtered;
  }
  if (candidates.length === 1) return candidates[0];

  const slotIdx = Math.floor(now / Math.max(1, slotMs));
  const phase = userPhase(userId);
  const idx = (slotIdx + phase) % candidates.length;
  const candidate = candidates[idx];
  if (candidate === lastProvider && candidates.length > 1) {
    return candidates[(idx + 1) % candidates.length];
  }
  return candidate;
}

/**
 * Pure grace-period check. Returns ms remaining (>0 means user is still in
 * the free verification window).
 */
export function graceRemainingMs(args: {
  createdAt: Date | null;
  graceDays: number;
  now: number;
}): number {
  if (args.graceDays <= 0 || !args.createdAt) return 0;
  const expires = args.createdAt.getTime() + args.graceDays * 24 * 60 * 60 * 1000;
  return Math.max(0, expires - args.now);
}
