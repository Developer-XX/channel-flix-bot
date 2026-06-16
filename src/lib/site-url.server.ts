// Single source of truth for the public website origin used in redirects,
// verification callbacks and any URL we hand back to the user.
//
// Priority (first non-empty wins):
//   1. PUBLIC_BASE_URL          ← preferred, explicit env override
//   2. SITE_URL                 ← legacy alias
//   3. PUBLIC_SITE_URL          ← legacy alias
//   4. "https://channel-flix-bot.lovable.app" ← published Lovable URL fallback
//
// The preview URL (`*-preview--*.lovable.app`) is NEVER used — it expires
// with each new preview build and breaks shared links.

const FALLBACK = "https://channel-flix-bot.lovable.app";

export function getPublicBaseUrl(): string {
  const raw =
    process.env.PUBLIC_BASE_URL ??
    process.env.SITE_URL ??
    process.env.PUBLIC_SITE_URL ??
    FALLBACK;
  // Strip trailing slash for predictable concatenation.
  return raw.replace(/\/+$/, "");
}

export function getPublicBaseUrlSource(): {
  url: string;
  source: "PUBLIC_BASE_URL" | "SITE_URL" | "PUBLIC_SITE_URL" | "fallback";
  fallback: string;
} {
  if (process.env.PUBLIC_BASE_URL) return { url: getPublicBaseUrl(), source: "PUBLIC_BASE_URL", fallback: FALLBACK };
  if (process.env.SITE_URL) return { url: getPublicBaseUrl(), source: "SITE_URL", fallback: FALLBACK };
  if (process.env.PUBLIC_SITE_URL) return { url: getPublicBaseUrl(), source: "PUBLIC_SITE_URL", fallback: FALLBACK };
  return { url: FALLBACK, source: "fallback", fallback: FALLBACK };
}

// Heuristic: a host looks "broken" (non-shareable) when it's the per-preview
// Lovable subdomain that rotates per build, or any localhost / IP.
export function isBrokenOrigin(origin: string | null | undefined): boolean {
  if (!origin) return true;
  try {
    const u = new URL(origin);
    const h = u.hostname;
    if (h === "localhost" || h === "127.0.0.1" || /^\d+\.\d+\.\d+\.\d+$/.test(h)) return true;
    // id-preview--<uuid>.lovable.app / project--<uuid>.lovable.app — not user-facing
    if (/^id-preview--/.test(h)) return true;
    if (/^project--[0-9a-f-]{36}/.test(h)) return true;
    return false;
  } catch {
    return true;
  }
}
