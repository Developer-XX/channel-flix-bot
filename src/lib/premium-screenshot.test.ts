import { describe, expect, it, vi } from "vitest";
import {
  PAYMENT_PROOFS_BUCKET,
  SCREENSHOT_PATH_MAX,
  normalizeScreenshotPath,
  validateScreenshotPath,
  type ScreenshotStorage,
} from "./premium-screenshot";

const USER = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

function makeStorage(opts: {
  expectedDir?: string;
  expectedFile?: string;
  files?: string[];
  error?: { message: string };
}): { storage: ScreenshotStorage; list: ReturnType<typeof vi.fn> } {
  const list = vi.fn(async (dir: string, query: { search: string; limit: number }) => {
    if (opts.error) return { data: null, error: opts.error };
    if (opts.expectedDir !== undefined) expect(dir).toBe(opts.expectedDir);
    if (opts.expectedFile !== undefined) expect(query.search).toBe(opts.expectedFile);
    const data = (opts.files ?? []).map((name) => ({ name }));
    return { data, error: null };
  });
  const storage: ScreenshotStorage = {
    from(bucket: string) {
      expect(bucket).toBe(PAYMENT_PROOFS_BUCKET);
      return { list };
    },
  };
  return { storage, list };
}

describe("normalizeScreenshotPath", () => {
  it("accepts a path inside the caller's own folder", () => {
    expect(normalizeScreenshotPath(`${USER}/proof.jpg`, USER)).toEqual({
      ok: true,
      normalized: `${USER}/proof.jpg`,
      dir: USER,
      fileName: "proof.jpg",
    });
  });

  it("strips a leading slash before checking the prefix", () => {
    const r = normalizeScreenshotPath(`/${USER}/sub/proof.jpg`, USER);
    expect(r).toEqual({
      ok: true,
      normalized: `${USER}/sub/proof.jpg`,
      dir: `${USER}/sub`,
      fileName: "proof.jpg",
    });
  });

  it("rejects another user's folder", () => {
    expect(normalizeScreenshotPath(`${OTHER}/proof.jpg`, USER)).toEqual({
      ok: false,
      reason: "outside_folder",
    });
  });

  it("rejects paths with no folder prefix", () => {
    expect(normalizeScreenshotPath("proof.jpg", USER)).toEqual({
      ok: false,
      reason: "outside_folder",
    });
  });

  it("rejects `..` traversal segments even when the prefix matches", () => {
    expect(normalizeScreenshotPath(`${USER}/../${OTHER}/proof.jpg`, USER)).toEqual({
      ok: false,
      reason: "traversal",
    });
  });

  it("rejects nested `..` segments", () => {
    expect(normalizeScreenshotPath(`${USER}/sub/../../etc/proof.jpg`, USER)).toEqual({
      ok: false,
      reason: "traversal",
    });
  });

  it("rejects strings shorter than the minimum", () => {
    expect(normalizeScreenshotPath("ab", USER)).toEqual({ ok: false, reason: "too_short" });
  });

  it("rejects strings longer than the maximum", () => {
    const long = `${USER}/${"a".repeat(SCREENSHOT_PATH_MAX)}`;
    expect(long.length).toBeGreaterThan(SCREENSHOT_PATH_MAX);
    expect(normalizeScreenshotPath(long, USER)).toEqual({ ok: false, reason: "too_long" });
  });

  it("accepts the maximum length boundary exactly", () => {
    const fill = SCREENSHOT_PATH_MAX - (USER.length + 1);
    const path = `${USER}/${"a".repeat(fill)}`;
    expect(path.length).toBe(SCREENSHOT_PATH_MAX);
    const r = normalizeScreenshotPath(path, USER);
    expect(r.ok).toBe(true);
  });

  it("rejects a path that resolves to an empty filename", () => {
    expect(normalizeScreenshotPath(`${USER}/`, USER)).toEqual({
      ok: false,
      reason: "too_short",
    });
  });
});

describe("validateScreenshotPath", () => {
  it("returns ok with normalized path when the object exists under the user folder", async () => {
    const { storage, list } = makeStorage({
      expectedDir: USER,
      expectedFile: "proof.jpg",
      files: ["proof.jpg"],
    });
    const result = await validateScreenshotPath(`${USER}/proof.jpg`, USER, storage);
    expect(result).toEqual({ ok: true, normalized: `${USER}/proof.jpg` });
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("looks up the correct nested directory for the storage call", async () => {
    const { storage, list } = makeStorage({
      expectedDir: `${USER}/2024/01`,
      expectedFile: "proof.png",
      files: ["proof.png"],
    });
    const result = await validateScreenshotPath(`${USER}/2024/01/proof.png`, USER, storage);
    expect(result.ok).toBe(true);
    expect(list).toHaveBeenCalledWith(`${USER}/2024/01`, { search: "proof.png", limit: 1 });
  });

  it("rejects another user's path WITHOUT calling storage", async () => {
    const { storage, list } = makeStorage({ files: ["proof.jpg"] });
    const result = await validateScreenshotPath(`${OTHER}/proof.jpg`, USER, storage);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("outside_folder");
      expect(result.message).toMatch(/your own storage folder/i);
    }
    expect(list).not.toHaveBeenCalled();
  });

  it("rejects a traversal path WITHOUT calling storage", async () => {
    const { storage, list } = makeStorage({ files: ["anything"] });
    const result = await validateScreenshotPath(
      `${USER}/../${OTHER}/proof.jpg`,
      USER,
      storage,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("traversal");
    expect(list).not.toHaveBeenCalled();
  });

  it("rejects when the path exceeds the length cap WITHOUT calling storage", async () => {
    const { storage, list } = makeStorage({ files: [] });
    const long = `${USER}/${"a".repeat(SCREENSHOT_PATH_MAX)}`;
    const result = await validateScreenshotPath(long, USER, storage);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("too_long");
    expect(list).not.toHaveBeenCalled();
  });

  it("returns not_found when the object is not in the user's folder", async () => {
    const { storage } = makeStorage({
      expectedDir: USER,
      expectedFile: "proof.jpg",
      files: [],
    });
    const result = await validateScreenshotPath(`${USER}/proof.jpg`, USER, storage);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("not_found");
      expect(result.message).toMatch(/not found/i);
    }
  });

  it("returns not_found when list returns a similarly-named but non-matching file", async () => {
    // `search` is a prefix match in the storage SDK, so a sibling like
    // `proof.jpg.bak` could come back — make sure we still reject it.
    const { storage } = makeStorage({
      expectedDir: USER,
      expectedFile: "proof.jpg",
      files: ["proof.jpg.bak"],
    });
    const result = await validateScreenshotPath(`${USER}/proof.jpg`, USER, storage);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not_found");
  });

  it("surfaces a storage_error when the SDK returns an error", async () => {
    const { storage } = makeStorage({ error: { message: "boom" } });
    const result = await validateScreenshotPath(`${USER}/proof.jpg`, USER, storage);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("storage_error");
      expect(result.message).toBe("boom");
    }
  });
});
