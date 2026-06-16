// Pure helpers for episode-file resolution. Kept free of any Supabase
// client so they can be unit-tested without mocks.

export type EpisodeInputValidation =
  | { ok: true }
  | { ok: false; reason: "parse_failed"; detail: string };

export function validateEpisodeInput(input: {
  titleId?: string | null;
  season?: number | null;
  episode?: number | null;
}): EpisodeInputValidation {
  if (!input.titleId) {
    return { ok: false, reason: "parse_failed", detail: "Missing titleId" };
  }
  if (input.season != null && !(Number.isFinite(input.season) && input.season >= 0)) {
    return {
      ok: false,
      reason: "parse_failed",
      detail: `Invalid season number: ${String(input.season)}`,
    };
  }
  if (input.episode != null && !(Number.isFinite(input.episode) && input.episode >= 0)) {
    return {
      ok: false,
      reason: "parse_failed",
      detail: `Invalid episode number: ${String(input.episode)}`,
    };
  }
  return { ok: true };
}

export type ResolveRow = { id: string; [k: string]: unknown };
export type ResolveDecision =
  | { ok: true; file: ResolveRow; changed: boolean }
  | { ok: false; reason: "not_found"; detail: string }
  | { ok: false; reason: "parse_failed"; detail: string };

export function decideEpisodeResolution(
  validation: EpisodeInputValidation,
  rows: ResolveRow[] | null | undefined,
  expectedFileId?: string | null,
): ResolveDecision {
  if (!validation.ok) return validation;
  const row = rows?.[0];
  if (!row) {
    return {
      ok: false,
      reason: "not_found",
      detail: "No matching episode file was found.",
    };
  }
  const changed = expectedFileId ? row.id !== expectedFileId : false;
  return { ok: true, file: row, changed };
}

export function describeResolveFailure(
  reason: "parse_failed" | "not_found" | "title_missing" | string,
): string {
  switch (reason) {
    case "parse_failed":
      return "We couldn't read the season/episode for this file.";
    case "not_found":
      return "We couldn't find the matching episode in the library.";
    case "title_missing":
      return "The title for this episode is no longer available.";
    default:
      return "Couldn't resolve the episode file.";
  }
}
