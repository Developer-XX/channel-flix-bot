// Single source of truth for the public website origin used in redirects,
// verification callbacks and any URL we hand back to the user.
//
// Priority (first non-empty wins):
//   1. app_settings.PUBLIC_BASE_URL   ← admin-editable runtime override
//   2. PUBLIC_BASE_URL env            ← env override
//   3. SITE_URL env                   ← legacy alias
//   4. PUBLIC_SITE_URL env            ← legacy alias
//   5. "https://channel-flix-bot.lovable.app" ← published Lovable URL fallback
//
// The preview URL (`*-preview--*.lovable.app`) is NEVER used.

const FALLBACK = "https://channel-flix-bot.lovable.app";

function fromEnv(): string {
  return (
    process.env.PUBLIC_BASE_URL ??
    process.env.SITE_URL ??
    process.env.PUBLIC_SITE_URL ??
    FALLBACK
  ).replace(/\/+$/, "");
}

// Sync read (kept for code paths that can't await — uses env-only).
export function getPublicBaseUrl(): string {
  // The async variant is preferred everywhere new. Keeping sync version env-only
  // avoids a top-level await in callers.
  return fromEnv();
}

// Async variant: checks runtime settings first.
export async function getPublicBaseUrlAsync(): Promise<string> {
  try {
    const { getSetting } = await import("@/lib/runtime-settings.server");
    const v = await getSetting("PUBLIC_BASE_URL");
    if (v) return v.replace(/\/+$/, "");
  } catch {}
  return fromEnv();
}

export function getPublicBaseUrlSource(): {
  url: string;
  source: "PUBLIC_BASE_URL" | "SITE_URL" | "PUBLIC_SITE_URL" | "fallback";
  fallback: string;
} {
  if (process.env.PUBLIC_BASE_URL) return { url: fromEnv(), source: "PUBLIC_BASE_URL", fallback: FALLBACK };
  if (process.env.SITE_URL) return { url: fromEnv(), source: "SITE_URL", fallback: FALLBACK };
  if (process.env.PUBLIC_SITE_URL) return { url: fromEnv(), source: "PUBLIC_SITE_URL", fallback: FALLBACK };
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
    if (/^id-preview--/.test(h)) return true;
    if (/^project--[0-9a-f-]{36}/.test(h)) return true;
    return false;
  } catch {
    return true;
  }
}
