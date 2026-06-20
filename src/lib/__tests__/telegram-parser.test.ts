import { describe, it, expect } from "vitest";
import { parseMedia, parseSingleSource } from "@/lib/telegram-parser";

describe("telegram-parser: Season/Part/Episode extraction", () => {
  it("parses S02P2E01 → season 2, part 2, episode 1", () => {
    const p = parseMedia("Doraemon S02P2E01 1080p Hindi");
    expect(p.season).toBe(2);
    expect(p.part).toBe(2);
    expect(p.episode).toBe(1);
    expect(p.resolution).toBe("1080p");
  });

  it("parses lowercase s01p3e12 → season 1, part 3, episode 12", () => {
    const p = parseSingleSource("ShowName.s01p3e12.720p.WEB-DL.x265.mkv");
    expect(p.season).toBe(1);
    expect(p.part).toBe(3);
    expect(p.episode).toBe(12);
  });

  it("parses with dot separators S02.P2.E01", () => {
    const p = parseSingleSource("Show.S02.P2.E01.1080p");
    expect(p.season).toBe(2);
    expect(p.part).toBe(2);
    expect(p.episode).toBe(1);
  });

  it("parses Part keyword: S03 Part 4 E07", () => {
    const p = parseSingleSource("Show S03 Part 4 E07 720p");
    expect(p.season).toBe(3);
    expect(p.part).toBe(4);
    expect(p.episode).toBe(7);
  });

  it("parses Pt abbreviation: S02Pt2E05", () => {
    const p = parseSingleSource("Show S02Pt2E05");
    expect(p.season).toBe(2);
    expect(p.part).toBe(2);
    expect(p.episode).toBe(5);
  });

  it("keeps part null when no part marker is present", () => {
    const p = parseMedia("Doraemon S02E01 1080p Hindi");
    expect(p.season).toBe(2);
    expect(p.part).toBeNull();
    expect(p.episode).toBe(1);
  });

  it("parses standalone Part marker without inline P in SxxExx", () => {
    const p = parseSingleSource("Show Season 2 Part 2 Episode 5 1080p");
    expect(p.season).toBe(2);
    expect(p.part).toBe(2);
    expect(p.episode).toBe(5);
  });

  it("caption with part wins over filename without part", () => {
    const p = parseMedia("Show S01P2E03 1080p", "Show.S01E03.720p.mkv");
    expect(p.season).toBe(1);
    expect(p.part).toBe(2);
    expect(p.episode).toBe(3);
  });

  it("filename part fills in when caption lacks SxxPnEyy", () => {
    const p = parseMedia("Some short caption", "Show.S04P1E10.mkv");
    expect(p.season).toBe(4);
    expect(p.part).toBe(1);
    expect(p.episode).toBe(10);
  });

  it("supports two-digit episode and part: S10P12E150", () => {
    const p = parseSingleSource("Show S10P12E150");
    expect(p.season).toBe(10);
    expect(p.part).toBe(12);
    expect(p.episode).toBe(150);
  });

  it("falls back gracefully when no SxxEyy found", () => {
    const p = parseSingleSource("Random Movie 2023 1080p");
    expect(p.season).toBeNull();
    expect(p.episode).toBeNull();
    expect(p.part).toBeNull();
    expect(p.year).toBe(2023);
  });

  // ---- Real-world regression fixtures from Telegram captions/filenames ----

  it("parses [Animex] tagged caption with hyphenated part: Show.S01-P02-E07", () => {
    const p = parseSingleSource("[Animex] Show.S01-P02-E07.1080p.WEB-DL.Hindi");
    expect(p.season).toBe(1);
    expect(p.part).toBe(2);
    expect(p.episode).toBe(7);
    expect(p.resolution).toBe("1080p");
    expect(p.language).toBe("Hindi");
  });

  it("parses bracketed quality block before SxxPnEyy", () => {
    const p = parseSingleSource("Show Name [Dual Audio] (Hindi+English) S02P3E04 720p HEVC");
    expect(p.season).toBe(2);
    expect(p.part).toBe(3);
    expect(p.episode).toBe(4);
    expect(p.codec).toBe("x265");
  });

  it("parses S02 P02 E03 with spaces only", () => {
    const p = parseSingleSource("Show Name S02 P02 E03 1080p WEB-DL");
    expect(p.season).toBe(2);
    expect(p.part).toBe(2);
    expect(p.episode).toBe(3);
  });

  it("parses dotted separators in filenames: Show.S03.P1.E12", () => {
    const p = parseSingleSource("Show.Name.S03.P1.E12.720p.mkv");
    expect(p.season).toBe(3);
    expect(p.part).toBe(1);
    expect(p.episode).toBe(12);
  });

  it("does not treat episode P-letter as part when no marker (S01E05)", () => {
    const p = parseSingleSource("Doraemon S01E05 [Hindi] 480p");
    expect(p.season).toBe(1);
    expect(p.part).toBeNull();
    expect(p.episode).toBe(5);
  });

  it("ignores P inside title words (Pirates) — no spurious part", () => {
    const p = parseSingleSource("Pirates Show S04E02 1080p");
    expect(p.season).toBe(4);
    expect(p.part).toBeNull();
    expect(p.episode).toBe(2);
  });

  it("standalone Season+Part+Episode keywords: Season 5 Part 1 Episode 22", () => {
    const p = parseSingleSource("Show Season 5 Part 1 Episode 22 720p");
    expect(p.season).toBe(5);
    expect(p.part).toBe(1);
    expect(p.episode).toBe(22);
  });

  it("episode-range pattern (S01P2E01E02) returns first episode only", () => {
    const p = parseSingleSource("Show S01P2E01E02 1080p");
    expect(p.season).toBe(1);
    expect(p.part).toBe(2);
    expect(p.episode).toBe(1);
  });

  it("parses real Telegram caption with leading channel banner emoji", () => {
    const p = parseMedia("🔥 Premium Show 🔥\nS02P02E09\n📺 720p Hindi WEB-DL");
    expect(p.season).toBe(2);
    expect(p.part).toBe(2);
    expect(p.episode).toBe(9);
    expect(p.resolution).toBe("720p");
    expect(p.language).toBe("Hindi");
  });
});
