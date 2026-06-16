// Real-User Monitoring (RUM) for Core Web Vitals.
// Captures LCP / CLS / INP / FCP / TTFB from real visitors and posts them
// directly to the `web_vitals_events` table. The table has a permissive
// anon INSERT policy (with strict size validation) so no edge function is
// required. Reads are admin-only.
//
// Failures are intentionally silent — never block the page on telemetry.

import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from "web-vitals";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

let installed = false;
let sessionId: string | null = null;

function getSessionId(): string {
  if (sessionId) return sessionId;
  try {
    const existing = sessionStorage.getItem("rum.sid");
    if (existing) {
      sessionId = existing;
      return existing;
    }
    const fresh = crypto.randomUUID();
    sessionStorage.setItem("rum.sid", fresh);
    sessionId = fresh;
    return fresh;
  } catch {
    sessionId = crypto.randomUUID();
    return sessionId;
  }
}

function send(metric: Metric) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    const conn = (navigator as Navigator & { connection?: { effectiveType?: string } })
      .connection?.effectiveType ?? null;
    const payload = [
      {
        session_id: getSessionId(),
        route: location.pathname.slice(0, 512),
        metric: metric.name,
        // CLS is unitless, others are ms. We store the raw value.
        value: Number(metric.value.toFixed(4)),
        rating: metric.rating,
        navigation_type: (metric.navigationType ?? "").slice(0, 32),
        viewport_width: window.innerWidth,
        viewport_height: window.innerHeight,
        device_pixel_ratio: window.devicePixelRatio,
        connection_type: conn ? String(conn).slice(0, 32) : null,
        user_agent: navigator.userAgent.slice(0, 1024),
      },
    ];
    fetch(`${SUPABASE_URL}/rest/v1/web_vitals_events`, {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify(payload),
    }).catch(() => {});
  } catch {
    /* never break the page on telemetry */
  }
}

export function installWebVitals() {
  if (installed) return;
  if (typeof window === "undefined") return;
  // Skip when running under Playwright / automated browsers to avoid
  // polluting the dataset with test traffic.
  if (/HeadlessChrome|Playwright/i.test(navigator.userAgent)) return;
  installed = true;

  onCLS(send);
  onFCP(send);
  onINP(send);
  onLCP(send);
  onTTFB(send);
}
