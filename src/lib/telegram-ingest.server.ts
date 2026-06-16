// Shared ingestion pipeline for Telegram messages.
// Used by both the realtime webhook and the scheduled backfill job.
//
// Strict idempotency:
//   1. Every Telegram update_id is recorded in `telegram_webhook_events`.
//      A duplicate update_id short-circuits before any other write.
//   2. The ingest row is upserted on (telegram_channel_id, telegram_message_id).
//   3. A partial unique index on telegram_file_unique_id prevents the same
//      file from being ingested twice even if it's reposted to another channel.

import type { SupabaseClient } from "@supabase/supabase-js";
import { parseMedia, normalizeTitle, titleSimilarity } from "@/lib/telegram-parser";

const MATCH_THRESHOLD = 0.45;

// Stronger similarity: max of jaccard, containment, and substring boost.
function bestTitleScore(parsedTitle: string, candidate: string): number {
  const a = normalizeTitle(parsedTitle);
  const b = normalizeTitle(candidate);
  if (!a || !b) return 0;
  const jacc = titleSimilarity(parsedTitle, candidate);
  const A = new Set(a.split(" ").filter(Boolean));
  const B = new Set(b.split(" ").filter(Boolean));
  const small = A.size <= B.size ? A : B;
  const big = small === A ? B : A;
  let inter = 0;
  for (const t of small) if (big.has(t)) inter++;
  const containment = small.size ? inter / small.size : 0;
  const substr = a.includes(b) || b.includes(a) ? 0.9 : 0;
  return Math.max(jacc, containment, substr);
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
  const message = update.channel_post ?? update.edited_channel_post ?? update.message ?? update.edited_message;
  if (!message?.chat?.id || typeof update.update_id !== "number") {
    return { ok: true, status: "ignored", reason: "no_message" };
  }

  // Step 1: strict idempotency on update_id.
  const { error: evtErr } = await supabase
    .from("telegram_webhook_events")
    .insert({
      update_id: update.update_id,
      telegram_channel_id: message.chat.id,
      telegram_message_id: message.message_id,
      source,
      status: "received",
    });
  if (evtErr) {
    // 23505 = unique_violation -> already seen, drop silently.
    if ((evtErr as any).code === "23505") {
      return { ok: true, status: "duplicate", reason: "update_id_seen" };
    }
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

  // Optional channel registry
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

  const parsed = parseMedia(caption, file.file_name);

  // Match resolution order:
  //   1. Exact normalized alias (admin-curated, highest confidence)
  //   2. Token-overlap / containment scoring against master_titles
  let matchedTitleId: string | null = null;
  let matchScore: number | null = null;
  const normalized = normalizeTitle(parsed.title);

  if (normalized) {
    // 1. Alias lookup (exact or substring on normalized form)
    const { data: aliasHits } = await supabase
      .from("title_aliases")
      .select("title_id, normalized_alias")
      .or(`normalized_alias.eq.${normalized},normalized_alias.ilike.%${normalized}%`)
      .limit(10);
    for (const a of aliasHits ?? []) {
      if (a.normalized_alias === normalized) {
        matchedTitleId = a.title_id;
        matchScore = 1.0;
        break;
      }
      if (normalized.includes(a.normalized_alias) || a.normalized_alias.includes(normalized)) {
        matchedTitleId = a.title_id;
        matchScore = 0.95;
      }
    }

    // 2. Fuzzy title scoring (skip if alias already matched)
    if (!matchedTitleId) {
      const head =
        normalized.split(" ").filter((w) => w.length >= 3)[0] ??
        normalized.split(" ")[0] ?? "";
      if (head) {
        const { data: candidates } = await supabase
          .from("master_titles")
          .select("id, title, release_year, category")
          .ilike("title", `%${head}%`)
          .limit(25);
        for (const c of candidates ?? []) {
          const score = bestTitleScore(parsed.title, c.title);
          const yearOk = !parsed.year || !c.release_year || Math.abs(parsed.year - c.release_year) <= 1;
          const catOk = !parsed.category || c.category === parsed.category;
          let adj = score;
          if (!yearOk) adj *= 0.6;
          if (!catOk) adj *= 0.85;
          if (matchScore === null || adj > matchScore) {
            matchScore = adj;
            if (adj >= MATCH_THRESHOLD) matchedTitleId = c.id;
          }
        }
      }
    }
  }

  const status = matchedTitleId ? "matched" : "unmatched";

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
        matched_title_id: matchedTitleId,
        match_score: matchScore,
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

  if (chanRow?.id) {
    await supabase
      .from("telegram_channels")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("id", chanRow.id);
  }

  // Auto-promote matched ingest rows into media_files so the website
  // shows the file without manual admin action.
  let promotedFileId: string | null = null;
  if (matchedTitleId && file.file_id) {
    try {
      promotedFileId = await autoPromoteToMediaFile(supabase, {
        ingestId: ingestRow.id,
        titleId: matchedTitleId,
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
      });
    } catch (e) {
      console.warn("[telegram-ingest] auto-promote failed:", (e as Error).message);
    }
  }

  // Visual confirmation back to the channel: 👀 reaction always, plus a
  // small reply if the channel opted in via confirm_with_reply.
  try {
    const { setMessageReaction, replyToMessage } = await import("@/lib/telegram-api.server");
    void setMessageReaction(tgChannelId, tgMessageId, matchedTitleId ? "👍" : "👀");
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

  return { ok: true, status: "ingested", ingestId: ingestRow.id, matched: !!matchedTitleId, matchScore };
}

// Auto-promotion: creates (or updates) season → episode → media_files rows
// for a matched ingest. Idempotent on telegram_file_id (media_files PK).
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
  },
): Promise<string | null> {
  let episodeId: string | null = null;

  // Find / create season + episode rows when this is a series file.
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
      const { data: existingEp } = await supabase
        .from("episodes")
        .select("id")
        .eq("title_id", args.titleId)
        .eq("season_id", seasonId)
        .eq("episode_number", args.episode)
        .maybeSingle();
      episodeId = existingEp?.id ?? null;
      if (!episodeId) {
        const { data: ins } = await supabase
          .from("episodes")
          .insert({
            title_id: args.titleId,
            season_id: seasonId,
            episode_number: args.episode,
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
