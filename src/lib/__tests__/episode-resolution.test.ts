import { describe, it, expect } from "vitest";
import {
  validateEpisodeInput,
  decideEpisodeResolution,
} from "@/lib/episode-resolution";

describe("validateEpisodeInput", () => {
  it("rejects missing titleId", () => {
    const r = validateEpisodeInput({ season: 1, episode: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("parse_failed");
  });

  it("rejects NaN season", () => {
    const r = validateEpisodeInput({ titleId: "t", season: Number.NaN, episode: 1 });
    expect(r.ok).toBe(false);
  });

  it("rejects negative episode", () => {
    const r = validateEpisodeInput({ titleId: "t", season: 1, episode: -3 });
    expect(r.ok).toBe(false);
  });

  it("accepts null season/episode (e.g. movie file)", () => {
    expect(validateEpisodeInput({ titleId: "t" }).ok).toBe(true);
  });

  it("accepts valid integers", () => {
    expect(validateEpisodeInput({ titleId: "t", season: 2, episode: 5 }).ok).toBe(true);
  });
});

describe("decideEpisodeResolution", () => {
  const okValidation = { ok: true as const };

  it("propagates parse failures and never claims a file", () => {
    const r = decideEpisodeResolution(
      { ok: false, reason: "parse_failed", detail: "bad" },
      [{ id: "wrong" }],
      "expected",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("parse_failed");
  });

  it("returns not_found when no rows match — never redirects with wrong file", () => {
    const r = decideEpisodeResolution(okValidation, [], "expected");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_found");
  });

  it("flags `changed` when the resolved id differs from expected", () => {
    const r = decideEpisodeResolution(okValidation, [{ id: "new" }], "expected");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.file.id).toBe("new");
      expect(r.changed).toBe(true);
    }
  });

  it("does not mark changed when expected matches", () => {
    const r = decideEpisodeResolution(okValidation, [{ id: "same" }], "same");
    if (r.ok) expect(r.changed).toBe(false);
  });

  it("treats nullish rows as not_found", () => {
    const r = decideEpisodeResolution(okValidation, null, "expected");
    expect(r.ok).toBe(false);
  });
});
