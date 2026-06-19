// Pure helpers for validating a premium-payment screenshot path before it
// is persisted to `premium_payments.screenshot_url`. Extracted from
// `submitPremiumPayment` so the rules can be unit-tested independently.
//
// Rules:
//   * Path must be a non-empty string, at most 512 chars (matches the zod schema).
//   * After stripping leading slashes, path must start with `${userId}/`.
//   * Path may not contain `..` (no traversal segments).
//   * The referenced object must actually exist in the `payment-proofs`
//     bucket under the caller's folder.

export const SCREENSHOT_PATH_MAX = 512;
export const SCREENSHOT_PATH_MIN = 3;
export const PAYMENT_PROOFS_BUCKET = "payment-proofs";

export type ScreenshotStorage = {
  from(bucket: string): {
    list(
      dir: string,
      opts: { search: string; limit: number },
    ): Promise<{
      data: Array<{ name: string }> | null;
      error: { message: string } | null;
    }>;
  };
};

export type NormalizeResult =
  | { ok: true; normalized: string; dir: string; fileName: string }
  | { ok: false; reason: "too_short" | "too_long" | "outside_folder" | "traversal" };

export function normalizeScreenshotPath(rawPath: string, userId: string): NormalizeResult {
  if (typeof rawPath !== "string" || rawPath.length < SCREENSHOT_PATH_MIN) {
    return { ok: false, reason: "too_short" };
  }
  if (rawPath.length > SCREENSHOT_PATH_MAX) {
    return { ok: false, reason: "too_long" };
  }
  const normalized = rawPath.replace(/^\/+/, "");
  const prefix = `${userId}/`;
  if (!normalized.startsWith(prefix)) {
    return { ok: false, reason: "outside_folder" };
  }
  // Block any `..` segment (e.g. `me/../other/proof.jpg`).
  const segments = normalized.split("/");
  if (segments.some((s) => s === "..")) {
    return { ok: false, reason: "traversal" };
  }
  const rest = normalized.slice(prefix.length);
  const lastSlash = rest.lastIndexOf("/");
  const dir = lastSlash >= 0 ? `${prefix}${rest.slice(0, lastSlash)}` : prefix.replace(/\/$/, "");
  const fileName = lastSlash >= 0 ? rest.slice(lastSlash + 1) : rest;
  if (!fileName) {
    return { ok: false, reason: "too_short" };
  }
  return { ok: true, normalized, dir, fileName };
}

export type ValidateResult =
  | { ok: true; normalized: string }
  | { ok: false; reason: NormalizeResult extends { ok: false; reason: infer R } ? R : never | "not_found" | "storage_error"; message: string };

export async function validateScreenshotPath(
  rawPath: string,
  userId: string,
  storage: ScreenshotStorage,
): Promise<
  | { ok: true; normalized: string }
  | { ok: false; reason: "too_short" | "too_long" | "outside_folder" | "traversal" | "not_found" | "storage_error"; message: string }
> {
  const norm = normalizeScreenshotPath(rawPath, userId);
  if (!norm.ok) {
    return {
      ok: false,
      reason: norm.reason,
      message:
        norm.reason === "too_long"
          ? "Screenshot path is too long"
          : norm.reason === "too_short"
            ? "Screenshot path is too short"
            : "Screenshot must be in your own storage folder",
    };
  }
  const { data: listed, error: listErr } = await storage
    .from(PAYMENT_PROOFS_BUCKET)
    .list(norm.dir, { search: norm.fileName, limit: 1 });
  if (listErr) {
    return { ok: false, reason: "storage_error", message: listErr.message };
  }
  if (!listed || !listed.some((o) => o.name === norm.fileName)) {
    return {
      ok: false,
      reason: "not_found",
      message: "Screenshot not found in your storage folder",
    };
  }
  return { ok: true, normalized: norm.normalized };
}
