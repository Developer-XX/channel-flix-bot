// Pure helpers for ordering media files by visual quality.
// Preferred order: 480p → 720p → 1080p → 1440p → 2160p (4K) → others last.

const RANK: Record<string, number> = {
  "144": 0,
  "240": 1,
  "360": 2,
  "480": 3,
  "540": 4,
  "576": 5,
  "720": 6,
  "1080": 7,
  "1440": 8,
  "2160": 9,
  "4320": 10,
};

export function resolutionRank(value: string | number | null | undefined): number {
  if (value == null) return 999;
  const s = String(value).toLowerCase().trim();
  // Common labels
  if (s === "4k" || s === "uhd") return RANK["2160"];
  if (s === "8k") return RANK["4320"];
  if (s === "hd") return RANK["720"];
  if (s === "fhd") return RANK["1080"];
  if (s === "qhd") return RANK["1440"];
  if (s === "sd") return RANK["480"];
  // Extract first run of digits (e.g. "1080p", "1080P", "1920x1080")
  const m = s.match(/(\d{3,4})/g);
  if (!m) return 999;
  // For "1920x1080" pick the smaller (vertical) dimension
  const nums = m.map((n) => parseInt(n, 10)).filter(Number.isFinite);
  const key = String(Math.min(...nums));
  return RANK[key] ?? 999;
}

export function compareByResolution<T extends { resolution?: string | null; quality?: string | null; file_name?: string | null }>(
  a: T,
  b: T,
): number {
  const ra = Math.min(resolutionRank(a.resolution), resolutionRank(a.quality));
  const rb = Math.min(resolutionRank(b.resolution), resolutionRank(b.quality));
  if (ra !== rb) return ra - rb;
  return (a.file_name ?? "").localeCompare(b.file_name ?? "");
}
