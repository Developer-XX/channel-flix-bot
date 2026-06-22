// Shared ingestion pipeline for Telegram messages.
// Used by both the realtime webhook and the scheduled backfill job.

import type { SupabaseClient } from "@supabase/supabase-js";
import { parseMedia, normalizeTitle, titleSimilarity } from "@/lib/telegram-parser";

export type MatchingSettings = {
  threshold: number;
  use_aliases: boolean;
  use_substring: boolean;
  use_containment: boolean;
  use_jaccard: boolean;
  year_window: number;
  require_category_match: boolean;
};

export const DEFAULT_MATCHING_SETTINGS: MatchingSettings = {
  threshold: 0.45,
  use_aliases: true,
  use_substring: true,
  use_containment: true,
  use_jaccard: true,
  year_window: 1,
  require_category_match: false,
};

export async function loadMatchingSettings(
  supabase: SupabaseClient<any, any, any>,
): Promise<MatchingSettings> {
  const { data } = await supabase
    .from("telegram_bot_state")
    .select("matching_settings")
    .eq("id", "global")
    .maybeSingle();
  const raw = (data?.matching_settings ?? {}) as Partial<MatchingSettings>;
  return { ...DEFAULT_MATCHING_SETTINGS, ...raw };
}

// Combined score using only the rules enabled by `settings`.
export function bestTitleScore(
  parsedTitle: string,
  candidate: string,
  settings: MatchingSettings,
): { score: number; parts: { jaccard: number; containment: number; substring: number } } {
  const a = normalizeTitle(parsedTitle);
  const b = normalizeTitle(candidate);
  const parts = { jaccard: 0, containment: 0, substring: 0 };
  if (!a || !b) return { score: 0, parts };
  if (settings.use_jaccard) parts.jaccard = titleSimilarity(parsedTitle, candidate);
  if (settings.use_containment) {
    const A = new Set(a.split(" ").filter(Boolean));
    const B = new Set(b.split(" ").filter(Boolean));
    const small = A.size <= B.size ? A : B;
    const big = small === A ? B : A;
    let inter = 0;
    for (const t of small) if (big.has(t)) inter++;
    parts.containment = small.size ? inter / small.size : 0;
  }
  if (settings.use_substring && (a.includes(b) || b.includes(a))) parts.substring = 0.9;
  return { score: Math.max(parts.jaccard, parts.containment, parts.substring), parts };
}

export type MatchCandidate = {
  titleId: string;
  title: string;
  release_year: number | null;
  category: string | null;
  score: number;
  adjustedScore: number;
  parts: { jaccard: number; containment: number; substring: number };
  yearOk: boolean;
  categoryOk: boolean;
};

export type AliasHit = {
  titleId: string;
  alias: string;
  normalized: string;
  exact: boolean;
};

export type MatcherResult = {
  matchedTitleId: string | null;
  matchScore: number | null;
  matchedVia: "alias" | "fuzzy" | null;
  candidates: MatchCandidate[];
  aliasHits: AliasHit[];
  threshold: number;
};

export async function runMatcher(
  supabase: SupabaseClient<any, any, any>,
  parsed: { title: string; year: number | null; category: string | null },
  settings: MatchingSettings,
): Promise<MatcherResult> {
  const normalized = normalizeTitle(parsed.title);
  const aliasHits: AliasHit[] = [];
  const candidates: MatchCandidate[] = [];
  let matchedTitleId: string | null = null;
  let matchScore: number | null = null;
  let matchedVia: "alias" | "fuzzy" | null = null;

  if (!normalized) {
    return { matchedTitleId, matchScore, matchedVia, candidates, aliasHits, threshold: settings.threshold };
  }

  if (settings.use_aliases) {
    const { data: aliasRows } = await supabase
      .from("title_aliases")
      .select("title_id, alias, normalized_alias")
      .or(`normalized_alias.eq.${normalized},normalized_alias.ilike.%${normalized}%`)
      .limit(20);
    for (const a of aliasRows ?? []) {
      const exact = a.normalized_alias === normalized;
      const contained = normalized.includes(a.normalized_alias) || a.normalized_alias.includes(normalized);
      if (!exact && !contained) continue;
      aliasHits.push({ titleId: a.title_id, alias: a.alias, normalized: a.normalized_alias, exact });
      if (!matchedTitleId) {
        matchedTitleId = a.title_id;
        matchScore = exact ? 1.0 : 0.95;
        matchedVia = "alias";
        if (exact) break;
      }
    }
  }

  // Fuzzy candidates (always computed for diagnostics)
  const head =
    normalized.split(" ").filter((w) => w.length >= 3)[0] ??
    normalized.split(" ")[0] ?? "";
  if (head) {
    const { data: rows } = await supabase
      .from("master_titles")
      .select("id, title, release_year, category")
      .ilike("title", `%${head}%`)
      .limit(25);
    for (const c of rows ?? []) {
      const { score, parts } = bestTitleScore(parsed.title, c.title, settings);
      const yearOk = !parsed.year || !c.release_year || Math.abs(parsed.year - c.release_year) <= settings.year_window;
      const categoryOk = !parsed.category || !c.category || c.category === parsed.category;
      let adj = score;
      if (!yearOk) adj *= 0.6;
      if (settings.require_category_match && !categoryOk) adj = 0;
      else if (!categoryOk) adj *= 0.85;
      candidates.push({
        titleId: c.id,
        title: c.title,
        release_year: c.release_year,
        category: c.category,
        score,
        adjustedScore: adj,
        parts,
        yearOk,
        categoryOk,
      });
    }
    candidates.sort((a, b) => b.adjustedScore - a.adjustedScore);

    if (!matchedTitleId && candidates.length) {
      const top = candidates[0];
      if (top.adjustedScore >= settings.threshold) {
        matchedTitleId = top.titleId;
        matchScore = top.adjustedScore;
        matchedVia = "fuzzy";
      } else {
        matchScore = top.adjustedScore;
      }
    }
  }

  return {
    matchedTitleId,
    matchScore,
    matchedVia,
    candidates: candidates.slice(0, 8),
    aliasHits,
    threshold: settings.threshold,
  };
}

export type TgMessage = {
  message_id: number;
  chat: { id: number; title?: string; username?: string };
  caption?: string | null;
  text?: string | null;
  document?: any;
  video?: any;
  audio?: any;
  animation?: any;
  photo?: Array<{ file_id: string; file_unique_id: string; file_size?: number }>;
};

export type TgUpdate = {
  update_id: number;
  channel_post?: TgMessage;
  edited_channel_post?: TgMessage;
  message?: TgMessage;
  edited_message?: TgMessage;
};

export type IngestOutcome =
  | { ok: true; status: "duplicate"; reason: string }
  | { ok: true; status: "ignored"; reason: string }
  | { ok: true; status: "ingested"; ingestId: string; matched: boolean; matchScore: number | null };

function extractFile(message: TgMessage) {
  const doc = message.document ?? message.video ?? message.audio ?? message.animation ?? null;
  if (doc) {
    return {
      file_id: doc.file_id ?? null,
      file_unique_id: doc.file_unique_id ?? null,
      file_name: doc.file_name ?? null,
      mime_type: doc.mime_type ?? null,
      file_size: typeof doc.file_size === "number" ? doc.file_size : null,
      duration_seconds: typeof doc.duration === "number" ? doc.duration : null,
    };
  }
  if (Array.isArray(message.photo) && message.photo.length) {
    const largest = message.photo[message.photo.length - 1];
    return {
      file_id: largest.file_id ?? null,
      file_unique_id: largest.file_unique_id ?? null,
      file_name: null,
      mime_type: "image/jpeg",
      file_size: largest.file_size ?? null,
      duration_seconds: null,
    };
  }
  return {
    file_id: null, file_unique_id: null, file_name: null,
    mime_type: null, file_size: null, duration_seconds: null,
  };
}

export async function ingestTelegramUpdate(
  supabase: SupabaseClient<any, any, any>,
  update: TgUpdate,
  source: "webhook" | "backfill",
): Promise<IngestOutcome> {
  const isEdit = !!(update.edited_channel_post || update.edited_message);
  const message = update.channel_post ?? update.edited_channel_post ?? update.message ?? update.edited_message;
  if (!message?.chat?.id || typeof update.update_id !== "number") {
    return { ok: true, status: "ignored", reason: "no_message" };
  }

  // Idempotent event row: upsert keyed by update_id. Webhook pre-inserts the
  // row with raw_update so it can ack Telegram quickly; if we re-enter from
  // the retry cron the row already exists. Only bail as a true duplicate when
  // a prior run already finished (processed_at IS NOT NULL).
  const { data: priorEvt } = await supabase
    .from("telegram_webhook_events")
    .select("processed_at")
    .eq("update_id", update.update_id)
    .maybeSingle();
  if (priorEvt?.processed_at) {
    return { ok: true, status: "duplicate", reason: "update_id_seen" };
  }
  const { error: evtErr } = await supabase
    .from("telegram_webhook_events")
    .upsert({
      update_id: update.update_id,
      telegram_channel_id: message.chat.id,
      telegram_message_id: message.message_id,
      source,
      status: "received",
    }, { onConflict: "update_id", ignoreDuplicates: false });
  if (evtErr) {
    throw evtErr;
  }


  const tgChannelId = message.chat.id;
  const tgMessageId = message.message_id;
  const caption = message.caption ?? message.text ?? null;
  const file = extractFile(message);

  if (!file.file_id) {
    await supabase.from("telegram_webhook_events")
      .update({ status: "ignored", error: "no_file" })
      .eq("update_id", update.update_id);
    return { ok: true, status: "ignored", reason: "no_file" };
  }

  const { data: chanRow } = await supabase
    .from("telegram_channels")
    .select("id, is_active")
    .eq("channel_id", tgChannelId)
    .maybeSingle();
  if (chanRow && chanRow.is_active === false) {
    await supabase.from("telegram_webhook_events")
      .update({ status: "ignored", error: "channel_inactive" })
      .eq("update_id", update.update_id);
    return { ok: true, status: "ignored", reason: "channel_inactive" };
  }

  // Snapshot the prior ingest row (if any) so we can detect title changes on
  // a caption edit and demote the previously-promoted media_files row.
  // `match_locked = true` means an admin manually assigned this row to a
  // title; the automatic matcher must NOT overwrite that assignment on a
  // later backfill / redeploy / channel re-scan.
  const { data: priorIngest } = await supabase
    .from("telegram_ingest")
    .select("id, matched_title_id, promoted_media_file_id, caption, match_score, match_locked")
    .eq("telegram_channel_id", tgChannelId)
    .eq("telegram_message_id", tgMessageId)
    .maybeSingle();

  const parsed = parseMedia(caption, file.file_name);
  const settings = await loadMatchingSettings(supabase);
  const match = await runMatcher(supabase, parsed, settings);
  const wasLocked = !!(priorIngest as any)?.match_locked && !!priorIngest?.matched_title_id;
  const effectiveTitleId = wasLocked ? priorIngest!.matched_title_id : match.matchedTitleId;
  const effectiveScore = wasLocked ? ((priorIngest as any).match_score ?? match.matchScore) : match.matchScore;
  const status = effectiveTitleId ? "matched" : "unmatched";


  const { data: ingestRow, error: ingestErr } = await supabase
    .from("telegram_ingest")
    .upsert(
      {
        channel_id: chanRow?.id ?? null,
        telegram_channel_id: tgChannelId,
        telegram_message_id: tgMessageId,
        telegram_file_id: file.file_id,
        telegram_file_unique_id: file.file_unique_id,
        file_name: file.file_name,
        caption,
        mime_type: file.mime_type,
        file_size: file.file_size,
        duration_seconds: file.duration_seconds,
        parsed_title: parsed.title,
        parsed_year: parsed.year,
        parsed_season: parsed.season,
        parsed_episode: parsed.episode,
        parsed_quality: parsed.quality,
        parsed_resolution: parsed.resolution,
        parsed_codec: parsed.codec,
        parsed_language: parsed.language,
        parsed_category: parsed.category,
        match_status: status,
        matched_title_id: effectiveTitleId,
        match_score: effectiveScore,
        update_id: update.update_id,
        raw_update: update as any,
      },
      { onConflict: "telegram_channel_id,telegram_message_id" },
    )
    .select("id")
    .single();

  if (ingestErr) {
    await supabase.from("telegram_webhook_events")
      .update({ status: "error", error: ingestErr.message })
      .eq("update_id", update.update_id);
    throw ingestErr;
  }

  await supabase.from("telegram_webhook_events")
    .update({ status: "processed" })
    .eq("update_id", update.update_id);

  // Invalidate downstream caches so /section/ and homepage reads pick up the
  // newly-ingested file on the very next request. Deterministic and global.
  try {
    const { bumpCacheVersionNow } = await import("@/lib/cache.server");
    await bumpCacheVersionNow();
  } catch (e) {
    console.warn("[telegram-ingest] cache bump failed:", (e as Error).message);
  }

  if (chanRow?.id) {
    await supabase
      .from("telegram_channels")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("id", chanRow.id);
  }

  // Audit + auto-promotion
  const { writeMatchAudit } = await import("@/lib/match-audit.server");
  const parsedSnapshot = {
    title: parsed.title, year: parsed.year, category: parsed.category,
    season: parsed.season, episode: parsed.episode,
    quality: parsed.quality, resolution: parsed.resolution, language: parsed.language,
  };

  // Caption-edit demotion: if this is an edit and the previously promoted
  // media_files row is now stale (title changed OR new match is below
  // threshold), deactivate it so it disappears from the old title's page.
  // The auto-promote below will (re)attach the file to the new title.
  const priorTitleId = priorIngest?.matched_title_id ?? null;
  const priorMediaFileId = priorIngest?.promoted_media_file_id ?? null;
  const titleChanged =
    !!priorTitleId && priorTitleId !== (effectiveTitleId ?? null);
  const becameUnmatched = !!priorTitleId && !effectiveTitleId;
  // Never demote/auto-reassign when the row is admin-locked.
  if (!wasLocked && (isEdit || priorIngest) && priorMediaFileId && (titleChanged || becameUnmatched)) {
    try {
      await supabase
        .from("media_files")
        .update({ is_active: false })
        .eq("id", priorMediaFileId);
      await writeMatchAudit(supabase, {
        ingestId: ingestRow.id,
        titleId: priorTitleId,
        settings,
        decision: "demoted",
        reason: becameUnmatched
          ? `caption_edit: now unmatched (was title ${priorTitleId})`
          : `caption_edit: title changed (was ${priorTitleId}, now ${effectiveTitleId})`,
        actor: "auto:caption-edit",
        oldScore: null,
        newScore: match.matchScore,
        threshold: settings.threshold,
        parsedSnapshot,
        extra: { mediaFileId: priorMediaFileId, priorCaption: priorIngest?.caption ?? null },
      });
      try {
        const { bumpCacheVersion } = await import("@/lib/indexes.server");
        await bumpCacheVersion(supabase);
      } catch {}
    } catch (e) {
      console.warn("[telegram-ingest] caption-edit demotion failed:", (e as Error).message);
    }
  }


  if (effectiveTitleId && file.file_id) {
    try {
      await autoPromoteToMediaFile(supabase, {
        ingestId: ingestRow.id,
        titleId: effectiveTitleId!,
        channelRowId: chanRow?.id ?? null,
        telegramFileId: file.file_id,
        telegramMessageId: tgMessageId,
        fileName: file.file_name ?? parsed.title ?? "file",
        caption,
        mimeType: file.mime_type,
        fileSize: file.file_size,
        durationSeconds: file.duration_seconds,
        quality: parsed.quality,
        resolution: parsed.resolution,
        language: parsed.language,
        season: parsed.season,
        episode: parsed.episode,
        part: parsed.part,
      });
      await writeMatchAudit(supabase, {
        ingestId: ingestRow.id,
        titleId: match.matchedTitleId,
        match,
        settings,
        decision: match.matchedVia === "alias" ? "alias" : "promoted",
        reason: `auto via ${match.matchedVia} score=${match.matchScore?.toFixed(3) ?? "?"}`,
        parsedSnapshot,
      });
      // Bump cache_version + auto-rebuild counter
      try {
        const { bumpCacheVersion, markPromotionForAutoRebuild } = await import("@/lib/indexes.server");
        await bumpCacheVersion(supabase);
        await markPromotionForAutoRebuild(supabase);
      } catch {}
    } catch (e) {
      console.warn("[telegram-ingest] auto-promote failed:", (e as Error).message);
      await writeMatchAudit(supabase, {
        ingestId: ingestRow.id,
        titleId: match.matchedTitleId,
        match,
        settings,
        decision: "rejected",
        reason: `promote_failed: ${(e as Error).message}`,
        parsedSnapshot,
      });
    }
  } else {
    await writeMatchAudit(supabase, {
      ingestId: ingestRow.id,
      titleId: null,
      match,
      settings,
      decision: "rejected",
      reason: match.matchScore != null
        ? `below_threshold (top=${match.matchScore.toFixed(3)} < ${settings.threshold})`
        : "no_candidates",
      parsedSnapshot,
    });
  }

  try {
    const { setMessageReaction, replyToMessage } = await import("@/lib/telegram-api.server");
    void setMessageReaction(tgChannelId, tgMessageId, match.matchedTitleId ? "👍" : "👀");
    if (chanRow?.id) {
      const { data: chanFull } = await supabase
        .from("telegram_channels")
        .select("confirm_with_reply")
        .eq("id", chanRow.id)
        .maybeSingle();
      if (chanFull?.confirm_with_reply) {
        const bits = [
          parsed.title ?? file.file_name ?? "ingested",
          parsed.season != null
            ? `S${String(parsed.season).padStart(2, "0")}${parsed.episode != null ? `E${String(parsed.episode).padStart(2, "0")}` : ""}`
            : null,
          parsed.resolution,
          parsed.quality,
        ].filter(Boolean).join(" · ");
        void replyToMessage(tgChannelId, tgMessageId, `✅ Ingested · ${bits}`);
      }
    }
  } catch (e) {
    console.warn("[telegram-ingest] confirmation failed:", (e as Error).message);
  }

  return { ok: true, status: "ingested", ingestId: ingestRow.id, matched: !!match.matchedTitleId, matchScore: match.matchScore };
}

export async function autoPromoteToMediaFile(
  supabase: SupabaseClient<any, any, any>,
  args: {
    ingestId: string;
    titleId: string;
    channelRowId: string | null;
    telegramFileId: string;
    telegramMessageId: number;
    fileName: string;
    caption: string | null;
    mimeType: string | null;
    fileSize: number | null;
    durationSeconds: number | null;
    quality: string | null;
    resolution: string | null;
    language: string | null;
    season: number | null;
    episode: number | null;
    part?: number | null;
  },
): Promise<string | null> {
  let episodeId: string | null = null;

  if (args.season != null) {
    const { data: existingSeason } = await supabase
      .from("seasons")
      .select("id")
      .eq("title_id", args.titleId)
      .eq("season_number", args.season)
      .maybeSingle();
    let seasonId = existingSeason?.id ?? null;
    if (!seasonId) {
      const { data: ins } = await supabase
        .from("seasons")
        .insert({ title_id: args.titleId, season_number: args.season })
        .select("id")
        .single();
      seasonId = ins?.id ?? null;
    }

    if (seasonId && args.episode != null) {
      // When the source declares a "Part" (e.g. S02P2E01 = Season 2 Part 2
      // Episode 1), encode the part into the episode_number so Part 1 Ep 1
      // (101) and Part 2 Ep 1 (201) don't collide within the same season.
      const encodedEpisode =
        args.part != null && args.part > 0
          ? args.part * 100 + args.episode
          : args.episode;
      const episodeName =
        args.part != null && args.part > 0
          ? `Part ${args.part} — Episode ${args.episode}`
          : null;

      const { data: existingEp } = await supabase
        .from("episodes")
        .select("id")
        .eq("title_id", args.titleId)
        .eq("season_id", seasonId)
        .eq("episode_number", encodedEpisode)
        .maybeSingle();
      episodeId = existingEp?.id ?? null;
      if (!episodeId) {
        const { data: ins } = await supabase
          .from("episodes")
          .insert({
            title_id: args.titleId,
            season_id: seasonId,
            episode_number: encodedEpisode,
            name: episodeName,
          })
          .select("id")
          .single();
        episodeId = ins?.id ?? null;
      }
    }
  }

  const { data: file, error: fileErr } = await supabase
    .from("media_files")
    .upsert(
      {
        title_id: args.titleId,
        episode_id: episodeId,
        channel_id: args.channelRowId,
        telegram_file_id: args.telegramFileId,
        telegram_message_id: args.telegramMessageId,
        file_name: args.fileName,
        caption: args.caption,
        file_size: args.fileSize,
        mime_type: args.mimeType,
        quality: args.quality,
        resolution: args.resolution,
        language: args.language,
        duration_seconds: args.durationSeconds,
        is_active: true,
      },
      { onConflict: "telegram_file_id" },
    )
    .select("id")
    .single();
  if (fileErr) throw fileErr;

  await supabase
    .from("telegram_ingest")
    .update({
      match_status: "matched",
      matched_title_id: args.titleId,
      promoted_media_file_id: file.id,
      last_error: null,
    })
    .eq("id", args.ingestId);

  return file.id;
}

/**
 * Re-score every ingest row currently promoted to `titleId` and demote any
 * row that no longer meets the matching threshold (e.g. because matching
 * settings tightened, the title's metadata changed, or the parsed metadata
 * was corrected). Demotion:
 *   - sets media_files.is_active = false (soft, recoverable)
 *   - clears telegram_ingest.promoted_media_file_id / matched_title_id
 *   - flips match_status to 'unmatched'
 *
 * Returns counts so callers can surface a clear summary.
 */
export async function revalidatePromotedForTitle(
  supabase: SupabaseClient<any, any, any>,
  title: { id: string; title: string; release_year: number | null; category: string | null },
  settings: Awaited<ReturnType<typeof loadMatchingSettings>>,
  opts?: { actor?: string },
): Promise<{ revalidated: number; demoted: number; kept: number; demotedIngestIds: string[] }> {
  const { writeMatchAudit } = await import("@/lib/match-audit.server");

  const { data: rows } = await supabase
    .from("telegram_ingest")
    .select("id, parsed_title, parsed_year, parsed_category, parsed_season, parsed_episode, promoted_media_file_id, deleted_at, match_locked")
    .eq("matched_title_id", title.id)
    .eq("match_locked", false)
    .not("promoted_media_file_id", "is", null)
    .is("deleted_at", null);

  let demoted = 0;
  let kept = 0;
  const demotedIngestIds: string[] = [];

  for (const r of rows ?? []) {
    const { score } = bestTitleScore(r.parsed_title ?? "", title.title, settings);
    const yearOk = !r.parsed_year || !title.release_year ||
      Math.abs(r.parsed_year - title.release_year) <= settings.year_window;
    const categoryOk = !r.parsed_category || !title.category || r.parsed_category === title.category;
    let adjusted = score;
    if (!yearOk) adjusted *= 0.6;
    if (settings.require_category_match && !categoryOk) adjusted = 0;
    else if (!categoryOk) adjusted *= 0.85;

    if (adjusted >= settings.threshold) {
      kept++;
      continue;
    }

    // Sticky admin overrides: never auto-demote a file whose most recent
    // decision for this (ingest, title) pair is a "manual" assignment or
    // an admin-curated "alias" hit. Admins explicitly bound this file to
    // the title — common for SxxPyEzz files where the parsed_title is
    // just "S02P2E01" with no show name, scoring poorly against the
    // master title on every resync.
    const { data: lastDecisionRow } = await supabase
      .from("match_audit_log")
      .select("decision")
      .eq("telegram_ingest_id", r.id)
      .eq("master_title_id", title.id)
      .in("decision", ["promoted", "manual", "alias", "demoted"])
      .order("attempt_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastDecision = (lastDecisionRow as { decision?: string } | null)?.decision ?? null;
    if (lastDecision === "manual" || lastDecision === "alias") {
      kept++;
      continue;
    }

    // Look up the prior promotion audit so we can record the old score
    // alongside the new (demoting) score for clear change-tracking.
    const { data: prevAudit } = await supabase
      .from("match_audit_log")
      .select("scores")
      .eq("telegram_ingest_id", r.id)
      .eq("master_title_id", title.id)
      .in("decision", ["promoted", "manual", "alias"])
      .order("attempt_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const oldScore = (prevAudit?.scores as any)?.total ?? null;

    const failReasons: string[] = [];
    if (!yearOk) failReasons.push("year_mismatch");
    if (!categoryOk) failReasons.push(settings.require_category_match ? "category_hard_mismatch" : "category_soft_mismatch");
    if (adjusted < settings.threshold) failReasons.push("below_threshold");
    const reason = `demoted:${failReasons.join("+") || "below_threshold"} (old=${oldScore ?? "?"} -> new=${adjusted.toFixed(3)} < ${settings.threshold})`;

    // Demote: deactivate media_files row, unlink ingest row.
    if (r.promoted_media_file_id) {
      await supabase
        .from("media_files")
        .update({ is_active: false })
        .eq("id", r.promoted_media_file_id);
    }
    await supabase
      .from("telegram_ingest")
      .update({
        match_status: "unmatched",
        matched_title_id: null,
        promoted_media_file_id: null,
        last_error: `Demoted on resync: score ${adjusted.toFixed(3)} < threshold ${settings.threshold}`,
      })
      .eq("id", r.id);

    await writeMatchAudit(supabase, {
      ingestId: r.id,
      titleId: title.id,
      settings,
      decision: "demoted",
      reason,
      actor: opts?.actor ?? "auto:revalidate",
      oldScore,
      newScore: adjusted,
      threshold: settings.threshold,
      parsedSnapshot: {
        title: r.parsed_title, year: r.parsed_year, category: r.parsed_category,
        season: r.parsed_season, episode: r.parsed_episode,
      },
      extra: { mediaFileId: r.promoted_media_file_id ?? null },
    });

    demoted++;
    demotedIngestIds.push(r.id);
  }

  return { revalidated: rows?.length ?? 0, demoted, kept, demotedIngestIds };
}


