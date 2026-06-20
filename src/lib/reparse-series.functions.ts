// Admin-only: re-parse already-ingested telegram rows to backfill
// season/part/episode metadata for files whose caption/filename uses the
// `SxxPnEyy` pattern (or any other pattern the parser now understands but
// didn't at original ingest time). Updates telegram_ingest.parsed_* and
// re-points media_files.episode_id to the encoded (part*100+ep) episode row,
// creating the season/episode rows when needed.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminAccess } from "@/lib/admin-auth";
import { parseMedia } from "@/lib/telegram-parser";

const Input = z.object({
  /** When true, report what would change without writing anything. */
  dryRun: z.boolean().default(false),
  /** Cap rows scanned per call (paged via offset). */
  limit: z.number().int().min(1).max(2000).default(500),
  offset: z.number().int().min(0).default(0),
  /** Restrict to a single title when set. */
  titleId: z.string().uuid().nullable().optional(),
  /** Max sample rows returned in the dry-run preview. */
  sampleLimit: z.number().int().min(0).max(500).default(25),
});

type ReparsedRow = {
  ingest_id: string;
  media_file_id: string | null;
  title_id: string;
  before: { season: number | null; episode: number | null };
  after: { season: number; part: number | null; episode: number; encoded_episode: number };
  caption_or_file: string;
};

export const reparseSeriesParts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => Input.parse(d))
  .handler(async ({ data, context }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let query = supabaseAdmin
      .from("telegram_ingest")
      .select(
        "id, caption, file_name, matched_title_id, parsed_season, parsed_episode, promoted_media_file_id",
      )
      .not("matched_title_id", "is", null)
      .or(
        // Cheap pre-filter: rows whose caption or filename contains a Part marker.
        "caption.ilike.%P%E%,file_name.ilike.%P%E%,caption.ilike.%Part%,file_name.ilike.%Part%",
      )
      .order("id", { ascending: true })
      .range(data.offset, data.offset + data.limit - 1);

    if (data.titleId) query = query.eq("matched_title_id", data.titleId);

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    const changed: ReparsedRow[] = [];
    let scanned = 0;
    let updatedIngest = 0;
    let relinkedFiles = 0;
    let seasonsCreated = 0;
    let episodesCreated = 0;

    for (const r of rows ?? []) {
      scanned++;
      const parsed = parseMedia(r.caption, r.file_name);
      if (
        parsed.season == null ||
        parsed.episode == null ||
        parsed.part == null
      ) {
        continue; // nothing new to encode
      }
      const encodedEpisode = parsed.part * 100 + parsed.episode;
      const isDifferent =
        r.parsed_season !== parsed.season ||
        r.parsed_episode !== encodedEpisode;
      if (!isDifferent) continue;

      changed.push({
        ingest_id: r.id,
        media_file_id: r.promoted_media_file_id,
        title_id: r.matched_title_id as string,
        before: { season: r.parsed_season, episode: r.parsed_episode },
        after: {
          season: parsed.season,
          part: parsed.part,
          episode: parsed.episode,
          encoded_episode: encodedEpisode,
        },
        caption_or_file: (r.caption ?? r.file_name ?? "").slice(0, 160),
      });

      if (data.dryRun) {
        // Even in dry-run, peek to determine whether the season/episode rows
        // would need to be created so admins can preview the full impact.
        const titleId = r.matched_title_id as string;
        const { data: existingSeason } = await supabaseAdmin
          .from("seasons")
          .select("id")
          .eq("title_id", titleId)
          .eq("season_number", parsed.season)
          .maybeSingle();
        if (!existingSeason?.id) {
          seasonsCreated++;
          episodesCreated++; // a missing season implies a missing episode too
        } else {
          const { data: existingEp } = await supabaseAdmin
            .from("episodes")
            .select("id")
            .eq("title_id", titleId)
            .eq("season_id", existingSeason.id)
            .eq("episode_number", encodedEpisode)
            .maybeSingle();
          if (!existingEp?.id) episodesCreated++;
        }
        if (r.promoted_media_file_id) relinkedFiles++;
        continue;
      }

      // Update parsed_* on the ingest row.
      await supabaseAdmin
        .from("telegram_ingest")
        .update({
          parsed_season: parsed.season,
          parsed_episode: encodedEpisode,
        })
        .eq("id", r.id);
      updatedIngest++;

      // Ensure season & episode rows exist, then relink the media_file.
      const titleId = r.matched_title_id as string;
      let seasonId: string | null = null;
      const { data: existingSeason } = await supabaseAdmin
        .from("seasons")
        .select("id")
        .eq("title_id", titleId)
        .eq("season_number", parsed.season)
        .maybeSingle();
      if (existingSeason?.id) {
        seasonId = existingSeason.id;
      } else {
        const { data: ins } = await supabaseAdmin
          .from("seasons")
          .insert({ title_id: titleId, season_number: parsed.season })
          .select("id")
          .single();
        seasonId = ins?.id ?? null;
        if (seasonId) seasonsCreated++;
      }

      if (!seasonId) continue;

      let episodeId: string | null = null;
      const { data: existingEp } = await supabaseAdmin
        .from("episodes")
        .select("id")
        .eq("title_id", titleId)
        .eq("season_id", seasonId)
        .eq("episode_number", encodedEpisode)
        .maybeSingle();
      if (existingEp?.id) {
        episodeId = existingEp.id;
      } else {
        const { data: ins } = await supabaseAdmin
          .from("episodes")
          .insert({
            title_id: titleId,
            season_id: seasonId,
            episode_number: encodedEpisode,
            name: `Part ${parsed.part} — Episode ${parsed.episode}`,
          })
          .select("id")
          .single();
        episodeId = ins?.id ?? null;
        if (episodeId) episodesCreated++;
      }

      if (episodeId && r.promoted_media_file_id) {
        await supabaseAdmin
          .from("media_files")
          .update({ episode_id: episodeId })
          .eq("id", r.promoted_media_file_id);
        relinkedFiles++;
      }
    }

    try {
      const { bumpCacheVersion } = await import("@/lib/indexes.server");
      if (!data.dryRun && changed.length > 0) await bumpCacheVersion(supabaseAdmin);
    } catch {}

    return {
      ok: true,
      dryRun: data.dryRun,
      scanned,
      changed_count: changed.length,
      updated_ingest: updatedIngest,
      relinked_files: relinkedFiles,
      seasons_created: seasonsCreated,
      episodes_created: episodesCreated,
      next_offset: (rows ?? []).length === data.limit ? data.offset + data.limit : null,
      samples: changed.slice(0, 25),
    };
  });
