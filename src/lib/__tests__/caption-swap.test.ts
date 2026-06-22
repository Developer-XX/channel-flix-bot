import { describe, it, expect } from "vitest";
import { parseMedia, parseSingleSource } from "@/lib/telegram-parser";

// Integration-style test: simulates a Telegram post whose caption is edited
// from one season/episode (and even a different show name) to another. The
// parser is the choke point that determines what the matcher sees, so the
// regressions we worry about (filename overriding caption, stale episode
// numbers, language fallback) all surface here.
describe("caption-priority parsing (caption swap scenarios)", () => {
  it("uses caption title when filename has a different show name", () => {
    const out = parseMedia(
      "Doraemon S02E01 1080p Hindi",
      "Chhota.Bheem.S01E01.720p.mkv",
    );
    expect(out.title.toLowerCase()).toContain("doraemon");
    expect(out.season).toBe(2);
    expect(out.episode).toBe(1);
    expect(out.resolution).toBe("1080p");
    expect(out.language).toBe("Hindi");
  });

  it("caption S/E wins over filename S/E (the original bug)", () => {
    const out = parseMedia(
      "MyShow S02E01 1080p WEB-DL",
      "MyShow.S01E01.720p.mkv",
    );
    expect(out.season).toBe(2);
    expect(out.episode).toBe(1);
  });

  it("simulates an edited caption moving the file from S01E01 to S03E05", () => {
    // Initial caption: S01E01
    const before = parseMedia("Doraemon S01E01 720p", "doraemon.mkv");
    expect(before.season).toBe(1);
    expect(before.episode).toBe(1);

    // Edited caption on the same Telegram post: S03E05
    const after = parseMedia("Doraemon S03E05 720p", "doraemon.mkv");
    expect(after.season).toBe(3);
    expect(after.episode).toBe(5);

    // Title still parses to the same show, so demotion would only happen on
    // the season/episode bucket — the matcher would still match the same
    // master_title, but the file moves to a new (season, episode) row.
    expect(after.title.toLowerCase()).toContain("doraemon");
  });

  it("parses SxxEyy even when Telegram caption misses the space before S", () => {
    const out = parseMedia(
      "Attack On TitanS01E24 1080p Hindi",
      "[@Anime_Hindi_SD_Official] - [S E] [].mp4",
    );
    expect(out.title).toBe("Attack On Titan");
    expect(out.season).toBe(1);
    expect(out.episode).toBe(24);
    expect(out.resolution).toBe("1080p");
    expect(out.language).toBe("Hindi");
  });

  it("falls back to filename when caption is empty", () => {
    const out = parseMedia(null, "Naruto.S04E12.1080p.HEVC.mkv");
    expect(out.title.toLowerCase()).toContain("naruto");
    expect(out.season).toBe(4);
    expect(out.episode).toBe(12);
  });

  it("falls back to filename when caption has no usable title", () => {
    // Caption is just resolution/tags — no title-like text.
    const out = parseMedia("1080p WEB-DL", "Attack.on.Titan.S01E01.mkv");
    expect(out.title.toLowerCase()).toContain("attack");
    expect(out.season).toBe(1);
  });

  it("parseSingleSource is independently inspectable for the admin debug panel", () => {
    const cap = parseSingleSource("Doraemon S02E01 1080p Hindi");
    const fn = parseSingleSource("Chhota.Bheem.S01E01.720p.mkv");
    expect(cap.title.toLowerCase()).toContain("doraemon");
    expect(fn.title.toLowerCase()).toContain("chhota");
    expect(cap.season).toBe(2);
    expect(fn.season).toBe(1);
  });
});
