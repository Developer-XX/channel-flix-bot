// Regression tests for the part/episode encoding contract used by
// reparse-series, episode-audit, and the SeasonAccordion UI fallback.
//
//   encoded_episode = part * 100 + episode   (when part is present)
//                   = episode                (when no part marker)
//
// If this rule ever changes, every consumer must change in lockstep.
import { describe, it, expect } from "vitest";
import { parseMedia } from "@/lib/telegram-parser";

function encode(p: { season: number | null; part: number | null; episode: number | null }): number | null {
  if (p.season == null || p.episode == null) return null;
  return p.part != null ? p.part * 100 + p.episode : p.episode;
}

function decode(encoded: number): { part: number | null; episode: number } {
  if (encoded >= 100) return { part: Math.floor(encoded / 100), episode: encoded % 100 };
  return { part: null, episode: encoded };
}

describe("episode encoding (part*100 + ep)", () => {
  it("encodes S02P2E01 → 201, decodes back to part=2 ep=1", () => {
    const p = parseMedia("Mighty Little Bheem S02P2E01");
    expect(p.season).toBe(2);
    expect(p.part).toBe(2);
    expect(p.episode).toBe(1);
    const e = encode(p);
    expect(e).toBe(201);
    expect(decode(e!)).toEqual({ part: 2, episode: 1 });
  });

  it("encodes S01P3E12 → 312", () => {
    const p = parseMedia(null, "Show.S01P3E12.mkv");
    expect(encode(p)).toBe(312);
  });

  it("plain S03E07 → 7 (no part encoding)", () => {
    const p = parseMedia("Show S03E07 1080p");
    expect(encode(p)).toBe(7);
    expect(decode(7)).toEqual({ part: null, episode: 7 });
  });

  it("Part 12 Episode 99 → 1299, round-trips", () => {
    const p = parseMedia("Show Season 5 Part 12 Episode 99");
    expect(encode(p)).toBe(1299);
    expect(decode(1299)).toEqual({ part: 12, episode: 99 });
  });

  it("returns null encoding when episode is missing", () => {
    const p = parseMedia("Random Movie 2023 1080p");
    expect(encode(p)).toBeNull();
  });

  it("returns null encoding when season is missing", () => {
    const p = parseMedia("Some Show Episode 5");
    // No season → contract says encoding is not meaningful.
    expect(encode(p)).toBeNull();
  });

  // Real Telegram caption fixtures
  it.each([
    ["Mighty Little Bheem S02P2E02 1080p Hindi", 2, 2, 2, 202],
    ["[ @Channel ] Show S04P1E15 720p WEB-DL", 4, 1, 15, 115],
    ["Show.S10.P2.E50.x265.mkv", 10, 2, 50, 250],
    ["Doraemon S01E05 [Hindi] 480p", 1, null, 5, 5],
  ])("fixture %s → S%i P%s E%i → encoded %i", (text, season, part, episode, encoded) => {
    const p = parseMedia(text);
    expect(p.season).toBe(season);
    expect(p.part).toBe(part);
    expect(p.episode).toBe(episode);
    expect(encode(p)).toBe(encoded);
  });
});
