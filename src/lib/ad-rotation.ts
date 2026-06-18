// Pure, SSR-safe ad rotation helpers. Extracted so we can deterministically
// stress-test scheduling + sort-order selection without spinning up a browser.

export type RotationAd = {
  id: string;
  placement: string;
  sort_order: number | null;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
};

export function filterScheduledAds<T extends RotationAd>(ads: T[], nowMs: number): T[] {
  return ads.filter((a) => {
    if (!a.is_active) return false;
    if (a.starts_at && new Date(a.starts_at).getTime() > nowMs) return false;
    if (a.ends_at && new Date(a.ends_at).getTime() < nowMs) return false;
    return true;
  });
}

/**
 * Deterministic, weighted rotation bucketed per-minute so the same visitor
 * sees the same ad briefly (no churn on every paint) but rotation still
 * happens across time. Lower sort_order wins more often.
 */
export function pickAd<T extends RotationAd>(
  ads: T[],
  placement: string,
  nowMs: number,
): T | null {
  if (!ads.length) return null;
  const maxSort = ads.reduce((m, a) => Math.max(m, a.sort_order ?? 0), 0);
  const weighted = ads.map((a) => ({
    ad: a,
    w: Math.max(1, maxSort - (a.sort_order ?? 0) + 1),
  }));
  const total = weighted.reduce((s, x) => s + x.w, 0);
  const bucket = Math.floor(nowMs / 60_000);
  let seed = 0;
  const key = `${bucket}:${placement}`;
  for (let i = 0; i < key.length; i++) seed = (seed * 31 + key.charCodeAt(i)) >>> 0;
  let r = (seed % total) + 1;
  for (const x of weighted) {
    r -= x.w;
    if (r <= 0) return x.ad;
  }
  return weighted[0].ad;
}
