// Caption / filename parser for Telegram media posts.
// Extracts title, year, season/episode, resolution, quality tag, codec, language.

export interface ParsedMedia {
  title: string;
  year: number | null;
  season: number | null;
  episode: number | null;
  resolution: string | null; // e.g. "1080p", "720p", "2160p"
  quality: string | null;    // e.g. "WEB-DL", "BluRay", "HDRip", "CAM"
  codec: string | null;      // e.g. "x264", "x265", "HEVC", "AV1"
  language: string | null;   // e.g. "Hindi", "English", "Dual Audio", "Multi"
}

const RES_RE = /\b(2160p|1440p|1080p|720p|480p|360p|4k|uhd)\b/i;
const QUALITY_RE = /\b(WEB[- ]?DL|WEB[- ]?Rip|WEBRip|BluRay|BRRip|BDRip|HDRip|DVDRip|HDTV|HDCAM|CAMRip|CAM|TS|TC|REMUX|PROPER)\b/i;
const CODEC_RE = /\b(x265|x264|h\.?265|h\.?264|HEVC|AVC|AV1|XviD|DivX)\b/i;
const LANG_RE = /\b(Hindi|English|Tamil|Telugu|Malayalam|Kannada|Bengali|Punjabi|Korean|Japanese|Spanish|French|German|Multi|Dual[- ]?Audio|Multi[- ]?Audio)\b/i;
const SE_RE = /S(\d{1,2})[\s._-]?E(\d{1,3})/i;
const SEASON_ONLY_RE = /\bSeason[\s._-]?(\d{1,2})\b/i;
const EPISODE_ONLY_RE = /\bEpisode[\s._-]?(\d{1,3})\b/i;
const YEAR_RE = /\b(19[5-9]\d|20[0-4]\d)\b/;

function cleanTitle(input: string): string {
  return input
    .replace(/[._]+/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function parseMedia(rawCaption: string | null | undefined, fileName?: string | null): ParsedMedia {
  const source = [rawCaption ?? "", fileName ?? ""].filter(Boolean).join(" \n ");
  const text = source.replace(/\s+/g, " ").trim();

  const resMatch = text.match(RES_RE);
  let resolution: string | null = null;
  if (resMatch) {
    const r = resMatch[1].toLowerCase();
    resolution = r === "4k" || r === "uhd" ? "2160p" : r;
  }

  const qualityMatch = text.match(QUALITY_RE);
  const codecMatch = text.match(CODEC_RE);
  const langMatch = text.match(LANG_RE);

  let season: number | null = null;
  let episode: number | null = null;
  const seMatch = text.match(SE_RE);
  if (seMatch) {
    season = parseInt(seMatch[1], 10);
    episode = parseInt(seMatch[2], 10);
  } else {
    const so = text.match(SEASON_ONLY_RE);
    if (so) season = parseInt(so[1], 10);
    const eo = text.match(EPISODE_ONLY_RE);
    if (eo) episode = parseInt(eo[1], 10);
  }

  const yearMatch = text.match(YEAR_RE);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : null;

  // Title = everything before the earliest discriminator (year, S01E01, resolution).
  const cutCandidates = [yearMatch?.index, seMatch?.index, resMatch?.index, qualityMatch?.index]
    .filter((i): i is number => typeof i === "number");
  const cut = cutCandidates.length ? Math.min(...cutCandidates) : text.length;
  const rawTitle = cleanTitle(text.slice(0, cut)).replace(/[-_:|]+$/g, "").trim();
  const title = rawTitle || cleanTitle(text).slice(0, 120) || "Untitled";

  return {
    title,
    year,
    season,
    episode,
    resolution,
    quality: qualityMatch ? qualityMatch[1].replace(/\s+/g, "-").toUpperCase() : null,
    codec: codecMatch ? codecMatch[1].toUpperCase().replace(".", "") : null,
    language: langMatch ? langMatch[1].replace(/\s+/g, " ") : null,
  };
}

// Normalize for fuzzy comparison
export function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

// Token Jaccard similarity in [0,1]
export function titleSimilarity(a: string, b: string): number {
  const A = new Set(normalizeTitle(a).split(" ").filter(Boolean));
  const B = new Set(normalizeTitle(b).split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / new Set([...A, ...B]).size;
}
