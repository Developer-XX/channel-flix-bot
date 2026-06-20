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
});
