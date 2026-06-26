// Helpers to reliably open Telegram links — some browsers (esp. in-app
// webviews / iframes) just "load" t.me URLs without redirecting to the app.
// We open the https URL in a new tab AND offer a tg:// deep-link fallback.

export function telegramDeepLink(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/(^|\.)t\.me$/i.test(u.hostname) && !/telegram\.me$/i.test(u.hostname)) return null;
    const seg = u.pathname.replace(/^\/+/, "").split("/").filter(Boolean);
    if (seg.length === 0) return null;
    // Invite links: t.me/+ABC or t.me/joinchat/ABC
    if (seg[0].startsWith("+")) return `tg://join?invite=${encodeURIComponent(seg[0].slice(1))}`;
    if (seg[0] === "joinchat" && seg[1]) return `tg://join?invite=${encodeURIComponent(seg[1])}`;
    // Public username (optionally /<post_id>)
    const domain = seg[0];
    const post = seg[1] && /^\d+$/.test(seg[1]) ? `&post=${seg[1]}` : "";
    return `tg://resolve?domain=${encodeURIComponent(domain)}${post}`;
  } catch {
    return null;
  }
}

/** Open a Telegram link in a way that actually reaches the app/browser. */
export function openTelegramLink(url: string): void {
  if (typeof window === "undefined") return;
  try {
    // Always escape any iframe / preview wrapper so shorteners/Telegram don't
    // get sand-boxed inside our page.
    const target = window.top && window.top !== window.self ? window.top : window;
    const w = target.open(url, "_blank", "noopener,noreferrer");
    if (!w) target.location.href = url;
  } catch {
    window.location.href = url;
  }
}
