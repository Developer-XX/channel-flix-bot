// Caption / filename parser for Telegram media posts.
// Extracts title, year, season/episode, resolution, quality tag, codec, language, category.

import type { CategorySlug } from "@/lib/categories";

export interface ParsedMedia {
  title: string;
  year: number | null;
  season: number | null;
  episode: number | null;
  resolution: string | null; // "2160p" | "1080p" | "720p" | ...
  quality: string | null;    // "WEB-DL" | "BLURAY" | ...
  codec: string | null;      // "x265" | "x264" | "HEVC" | ...
  language: string | null;   // "Hindi", "English", "Hindi+English", "Dual Audio", ...
  category: CategorySlug | null;
}

const RES_PATTERNS: Array<[RegExp, string]> = [
  [/\b(2160p|4k|uhd)\b/i, "2160p"],
  [/\b1440p\b/i, "1440p"],
  [/\b1080p?\b/i, "1080p"],
  [/\b720p?\b/i, "720p"],
  [/\b480p?\b/i, "480p"],
  [/\b360p?\b/i, "360p"],
];

const QUALITY_PATTERNS: Array<[RegExp, string]> = [
  [/\bWEB[\s._-]?DL\b/i, "WEB-DL"],
  [/\bWEB[\s._-]?Rip\b/i, "WEBRip"],
  [/\bWEBRip\b/i, "WEBRip"],
  [/\bBlu[\s._-]?Ray\b/i, "BLURAY"],
  [/\bBR[\s._-]?Rip\b/i, "BRRip"],
  [/\bBD[\s._-]?Rip\b/i, "BDRip"],
  [/\bREMUX\b/i, "REMUX"],
  [/\bHD[\s._-]?Rip\b/i, "HDRip"],
  [/\bDVD[\s._-]?Rip\b/i, "DVDRip"],
  [/\bHDTV\b/i, "HDTV"],
  [/\bPRE[\s._-]?DVD\b/i, "PreDVD"],
  [/\bHD[\s._-]?CAM\b/i, "HDCAM"],
  [/\bCAM[\s._-]?Rip\b/i, "CAMRip"],
  [/\bCAM\b/i, "CAM"],
  [/\bTS\b/i, "TS"],
  [/\bTC\b/i, "TC"],
  [/\bPROPER\b/i, "PROPER"],
];

const CODEC_PATTERNS: Array<[RegExp, string]> = [
  [/\b(x265|h\.?265|HEVC)\b/i, "x265"],
  [/\b(x264|h\.?264|AVC)\b/i, "x264"],
  [/\bAV1\b/i, "AV1"],
  [/\bXviD\b/i, "XviD"],
  [/\bDivX\b/i, "DivX"],
];

const LANG_TOKENS = [
  "Hindi", "English", "Tamil", "Telugu", "Malayalam", "Kannada", "Bengali",
  "Punjabi", "Marathi", "Gujarati", "Urdu",
  "Korean", "Japanese", "Chinese", "Mandarin", "Cantonese",
  "Spanish", "French", "German", "Italian", "Portuguese", "Russian", "Turkish", "Arabic",
];
const LANG_RE = new RegExp(`\\b(${LANG_TOKENS.join("|")})\\b`, "gi");
const DUAL_RE = /\b(Dual[\s._-]?Audio|Multi[\s._-]?Audio|Multi|Dubbed|Subbed|Subtitled)\b/i;

const SE_RE = /\bS(\d{1,2})[\s._-]?E(\d{1,3}(?:[\s._-]?E\d{1,3})*)\b/i;
const SEASON_ONLY_RE = /\bSeason[\s._-]?(\d{1,2})\b/i;
const EPISODE_ONLY_RE = /\b(?:Episode|EP|Ep)[\s._-]?(\d{1,3})\b/i;
const YEAR_RE = /\b(19[5-9]\d|20[0-4]\d)\b/;

// Category cues
const ANIME_RE = /\b(anime|sub\s*indo|fansub|crunchyroll|jujutsu|naruto|one\s*piece|demon\s*slayer|attack\s*on\s*titan)\b/i;
const KDRAMA_RE = /\b(k[-\s]?drama|korean\s*drama|kbs|tvN|kocowa)\b/i;
const CARTOON_RE = /\b(cartoon|nickelodeon|cartoon\s*network|disney\s*junior|paw\s*patrol|spongebob)\b/i;
const DOC_RE = /\b(documentary|docu(?:series)?|nat\s*geo|bbc\s*earth|discovery)\b/i;

function cleanTitle(input: string): string {
  return input
    .replace(/[._]+/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[-_:|]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function firstMatch(
  text: string,
  patterns: Array<[RegExp, string]>,
): { value: string; index: number } | null {
  let best: { value: string; index: number } | null = null;
  for (const [re, val] of patterns) {
    const m = text.match(re);
    if (m && m.index !== undefined) {
      if (!best || m.index < best.index) best = { value: val, index: m.index };
    }
  }
  return best;
}

function detectCategory(text: string, season: number | null): CategorySlug | null {
  if (ANIME_RE.test(text)) return "anime";
  if (KDRAMA_RE.test(text)) return "kdrama";
  if (CARTOON_RE.test(text)) return "cartoon";
  if (DOC_RE.test(text)) return "documentary";
  if (season !== null) return "series";
  // Default: a media file with year and resolution is most likely a movie.
  return null;
}

function parseSingleSource(raw: string): ParsedMedia {
  const text = raw.replace(/\s+/g, " ").trim();

  const res = firstMatch(text, RES_PATTERNS);
  const quality = firstMatch(text, QUALITY_PATTERNS);
  const codec = firstMatch(text, CODEC_PATTERNS);

  const langs: string[] = [];
  const langMatches = text.matchAll(LANG_RE);
  for (const m of langMatches) {
    const tok = m[1];
    const norm = tok.charAt(0).toUpperCase() + tok.slice(1).toLowerCase();
    if (!langs.includes(norm)) langs.push(norm);
  }
  const dual = text.match(DUAL_RE);
  let language: string | null = null;
  if (langs.length >= 2) language = langs.slice(0, 3).join("+");
  else if (langs.length === 1) language = dual ? `${langs[0]} (Dual)` : langs[0];
  else if (dual) language = dual[1].replace(/[\s._-]+/g, " ");

  let season: number | null = null;
  let episode: number | null = null;
  const seMatch = text.match(SE_RE);
  if (seMatch) {
    season = parseInt(seMatch[1], 10);
    const epStr = seMatch[2].match(/\d+/g);
    if (epStr) episode = parseInt(epStr[0], 10);
  } else {
    const so = text.match(SEASON_ONLY_RE);
    if (so) season = parseInt(so[1], 10);
    const eo = text.match(EPISODE_ONLY_RE);
    if (eo) episode = parseInt(eo[1], 10);
  }

  const yearMatch = text.match(YEAR_RE);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : null;

  const cutCandidates = [
    yearMatch?.index,
    seMatch?.index,
    res?.index,
    quality?.index,
  ].filter((i): i is number => typeof i === "number");
  const cut = cutCandidates.length ? Math.min(...cutCandidates) : text.length;
  const rawTitle = cleanTitle(text.slice(0, cut));
  const title = rawTitle || cleanTitle(text).slice(0, 120) || "Untitled";

  const category = detectCategory(text, season);

  return {
    title,
    year,
    season,
    episode,
    resolution: res?.value ?? null,
    quality: quality?.value ?? null,
    codec: codec?.value ?? null,
    language,
    category,
  };
}

/**
 * Parse media metadata. **Caption is the primary source**; the filename is
 * only used to fill fields the caption didn't yield (or used entirely when
 * there is no caption). This matches Telegram channels where the uploader's
 * caption is curated (correct title, correct SxxEyy) while the filename is
 * often a leftover from the source release.
 *
 * Example:
 *   caption  = "Doraemon S02E01 1080p Hindi"
 *   fileName = "Chhota.Bheem.S01E01.720p.mkv"
 *   → title="Doraemon", season=2, episode=1, resolution="1080p", language="Hindi"
 */
export function parseMedia(rawCaption: string | null | undefined, fileName?: string | null): ParsedMedia {
  const cap = (rawCaption ?? "").trim();
  const fn = (fileName ?? "").trim();
  const captionParsed = cap ? parseSingleSource(cap) : null;
  const fileParsed = fn ? parseSingleSource(fn) : null;

  if (!captionParsed && !fileParsed) {
    return {
      title: "Untitled", year: null, season: null, episode: null,
      resolution: null, quality: null, codec: null, language: null, category: null,
    };
  }

  const pick = <K extends keyof ParsedMedia>(k: K): ParsedMedia[K] => {
    const cVal = captionParsed ? captionParsed[k] : null;
    const fVal = fileParsed ? fileParsed[k] : null;
    return (cVal ?? fVal) as ParsedMedia[K];
  };

  // Title: caption wins when it produced something usable; otherwise filename.
  const captionTitleUsable =
    !!captionParsed &&
    !!captionParsed.title &&
    captionParsed.title !== "Untitled" &&
    normalizeTitle(captionParsed.title).length >= 2;
  const title = captionTitleUsable
    ? captionParsed!.title
    : (fileParsed?.title && fileParsed.title !== "Untitled"
        ? fileParsed.title
        : (captionParsed?.title ?? "Untitled"));

  return {
    title,
    year: pick("year"),
    season: pick("season"),
    episode: pick("episode"),
    resolution: pick("resolution"),
    quality: pick("quality"),
    codec: pick("codec"),
    language: pick("language"),
    category: pick("category"),
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
