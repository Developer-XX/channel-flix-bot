// Helpers to reliably open Telegram links across desktop browsers, iOS Safari,
// Android Chrome, and in-app webviews. Many environments silently "load" the
// t.me URL without redirecting to the Telegram app; on iOS the tg:// scheme
// is required, while on desktop the https URL works best.

const TG_HOSTS = /(^|\.)(t\.me|telegram\.me|telegram\.dog)$/i;

export type TelegramLinkInfo = {
  /** The original (cleaned) https URL, or null when invalid. */
  https: string | null;
  /** A tg:// deep link if the URL points at a recognizable resource. */
  deep: string | null;
  /** True when the input looks like a real Telegram link. */
  valid: boolean;
};

/** Normalize and validate a Telegram URL string. Accepts bare usernames
 *  ("@username" or "username"), tg:// URLs, and t.me/telegram.me URLs. */
export function parseTelegramLink(input: string | null | undefined): TelegramLinkInfo {
  const raw = (input ?? "").trim();
  if (!raw) return { https: null, deep: null, valid: false };

  // Bare @username / username
  if (/^@?[a-z0-9_]{4,32}$/i.test(raw)) {
    const u = raw.replace(/^@/, "");
    return {
      https: `https://t.me/${u}`,
      deep: `tg://resolve?domain=${encodeURIComponent(u)}`,
      valid: true,
    };
  }

  // tg:// scheme — convert to a best-effort https equivalent
  if (/^tg:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      if (u.host === "resolve") {
        const dom = u.searchParams.get("domain");
        const post = u.searchParams.get("post");
        if (dom) {
          return {
            https: `https://t.me/${dom}${post ? `/${post}` : ""}`,
            deep: raw,
            valid: true,
          };
        }
      }
      if (u.host === "join") {
        const inv = u.searchParams.get("invite");
        if (inv) return { https: `https://t.me/+${inv}`, deep: raw, valid: true };
      }
      return { https: null, deep: raw, valid: true };
    } catch {
      return { https: null, deep: null, valid: false };
    }
  }

  // Coerce missing scheme
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, "")}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return { https: null, deep: null, valid: false };
  }
  if (!TG_HOSTS.test(u.hostname)) return { https: null, deep: null, valid: false };

  // Force https + canonical t.me
  u.protocol = "https:";
  if (/telegram\.me|telegram\.dog/i.test(u.hostname)) u.hostname = "t.me";
  const httpsUrl = u.toString().replace(/\/+$/, "");
  const seg = u.pathname.replace(/^\/+/, "").split("/").filter(Boolean);
  if (seg.length === 0) return { https: httpsUrl, deep: null, valid: true };

  // Invite links: t.me/+ABC or t.me/joinchat/ABC
  if (seg[0].startsWith("+")) {
    return { https: httpsUrl, deep: `tg://join?invite=${encodeURIComponent(seg[0].slice(1))}`, valid: true };
  }
  if (seg[0] === "joinchat" && seg[1]) {
    return { https: httpsUrl, deep: `tg://join?invite=${encodeURIComponent(seg[1])}`, valid: true };
  }
  // Public username (optionally /<post_id>)
  const domain = seg[0];
  if (!/^[a-z0-9_]{4,32}$/i.test(domain)) return { https: httpsUrl, deep: null, valid: true };
  const post = seg[1] && /^\d+$/.test(seg[1]) ? `&post=${seg[1]}` : "";
  return {
    https: httpsUrl,
    deep: `tg://resolve?domain=${encodeURIComponent(domain)}${post}`,
    valid: true,
  };
}

/** True when the input is a syntactically valid Telegram link. */
export function isValidTelegramUrl(input: string | null | undefined): boolean {
  return parseTelegramLink(input).valid;
}

/** Back-compat shim: returns just the tg:// deep link or null. */
export function telegramDeepLink(url: string): string | null {
  return parseTelegramLink(url).deep;
}

function detectPlatform(): "ios" | "android" | "other" {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "other";
}

/** Open a Telegram link with the best chance of reaching the installed app.
 *  - Mobile: try tg:// first (app picks it up), then fall back to https.
 *  - Desktop: open the https URL in a new tab so Telegram Web/desktop opens.
 *  - Iframes/in-app webviews: escape to top-level so shorteners don't sandbox. */
export function openTelegramLink(input: string | null | undefined): boolean {
  if (typeof window === "undefined") return false;
  const info = parseTelegramLink(input);
  if (!info.valid || (!info.https && !info.deep)) return false;
  const platform = detectPlatform();

  // Always try to escape iframes so the link actually navigates.
  let topWin: Window = window;
  try {
    if (window.top && window.top !== window.self) topWin = window.top as Window;
  } catch { /* cross-origin top, stay with self */ }

  const httpsUrl = info.https ?? "";
  const deepUrl = info.deep ?? "";

  if (platform === "ios" || platform === "android") {
    // On mobile, attempt deep link, then fall back to https after a short delay
    // if we're still here (i.e. Telegram isn't installed).
    if (deepUrl) {
      const fallback = httpsUrl || deepUrl;
      try {
        const t = Date.now();
        window.location.href = deepUrl;
        window.setTimeout(() => {
          // If the page is still visible after the timeout, Telegram likely
          // isn't installed — open the https variant in a new tab.
          if (Date.now() - t < 2000 && document.visibilityState === "visible") {
            try {
              const w = topWin.open(fallback, "_blank", "noopener,noreferrer");
              if (!w) topWin.location.href = fallback;
            } catch {
              window.location.href = fallback;
            }
          }
        }, 800);
        return true;
      } catch {
        /* fall through to https */
      }
    }
    if (httpsUrl) {
      try { window.location.href = httpsUrl; return true; } catch { return false; }
    }
    return false;
  }

  // Desktop: prefer https in a new tab (Telegram Web/desktop hands off to app).
  const url = httpsUrl || deepUrl;
  try {
    const w = topWin.open(url, "_blank", "noopener,noreferrer");
    if (!w) topWin.location.href = url;
    return true;
  } catch {
    try { window.location.href = url; return true; } catch { return false; }
  }
}
