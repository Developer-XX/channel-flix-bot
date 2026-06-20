// Admin-only: audit media_files for episode assignment health, find
// unassigned/incorrectly-linked rows, and run on-demand reparse for a
// specific channel or title (bypassing the cron schedule).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminAccess } from "@/lib/admin-auth";
import { parseMedia } from "@/lib/telegram-parser";

// -------------------- 1. Stats per channel --------------------

export const getEpisodeAuditStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Per-channel counts of unassigned media_files for series titles.
    const { data: files, error: fErr } = await supabaseAdmin
      .from("media_files")
      .select("id, channel_id, episode_id, title_id, caption, file_name")
      .eq("is_active", true);
    if (fErr) throw new Error(fErr.message);

    const { data: channels } = await supabaseAdmin
      .from("telegram_channels")
      .select("id, name, username");
    const chMap = new Map<string, { name: string; username: string | null }>();
    for (const c of (channels as any[]) ?? []) {
      chMap.set(c.id, { name: c.name, username: c.username });
    }

    // Per-channel counts of telegram_ingest parse failures.
    const { data: ingestRows } = await supabaseAdmin
      .from("telegram_ingest")
      .select("channel_id, match_status, parsed_season, parsed_episode, caption, file_name")
      .gt("created_at", new Date(Date.now() - 14 * 24 * 3600_000).toISOString());

    type Row = {
      channel_id: string | null;
      name: string;
      username: string | null;
      total_files: number;
      unassigned: number;
      ingest_total: number;
      ingest_unmatched: number;
      ingest_failed: number;
      parse_no_episode: number;
    };
    const byCh = new Map<string, Row>();
    const keyFor = (id: string | null) => id ?? "__none__";

    for (const f of (files as any[]) ?? []) {
      const k = keyFor(f.channel_id);
      const meta = f.channel_id ? chMap.get(f.channel_id) : null;
      const row =
        byCh.get(k) ??
        ({
          channel_id: f.channel_id,
          name: meta?.name ?? "(no channel)",
          username: meta?.username ?? null,
          total_files: 0,
          unassigned: 0,
          ingest_total: 0,
          ingest_unmatched: 0,
          ingest_failed: 0,
          parse_no_episode: 0,
        } satisfies Row);
      row.total_files++;
      if (!f.episode_id) row.unassigned++;
      byCh.set(k, row);
    }

    for (const ir of (ingestRows as any[]) ?? []) {
      const k = keyFor(ir.channel_id);
      const meta = ir.channel_id ? chMap.get(ir.channel_id) : null;
      const row =
        byCh.get(k) ??
        ({
          channel_id: ir.channel_id,
          name: meta?.name ?? "(no channel)",
          username: meta?.username ?? null,
          total_files: 0,
          unassigned: 0,
          ingest_total: 0,
          ingest_unmatched: 0,
          ingest_failed: 0,
          parse_no_episode: 0,
        } satisfies Row);
      row.ingest_total++;
      if (ir.match_status === "unmatched") row.ingest_unmatched++;
      if (ir.match_status === "failed") row.ingest_failed++;
      // Parser yielded no episode despite text suggesting an episode marker.
      const text = `${ir.caption ?? ""} ${ir.file_name ?? ""}`;
      if (/\b(S\d{1,2}|Season|Episode|EP\b)/i.test(text)) {
        const p = parseMedia(ir.caption, ir.file_name);
        if (p.episode == null) row.parse_no_episode++;
      }
      byCh.set(k, row);
    }

    const rows = Array.from(byCh.values()).sort(
      (a, b) => b.unassigned + b.parse_no_episode - (a.unassigned + a.parse_no_episode),
    );

    const totals = rows.reduce(
      (acc, r) => {
        acc.total_files += r.total_files;
        acc.unassigned += r.unassigned;
        acc.ingest_total += r.ingest_total;
        acc.ingest_unmatched += r.ingest_unmatched;
        acc.ingest_failed += r.ingest_failed;
        acc.parse_no_episode += r.parse_no_episode;
        return acc;
      },
      { total_files: 0, unassigned: 0, ingest_total: 0, ingest_unmatched: 0, ingest_failed: 0, parse_no_episode: 0 },
    );

    return { rows, totals, generated_at: new Date().toISOString() };
  });

// -------------------- 2. List unassigned/mismatched with expected match --------------------

const ListInput = z.object({
  channelId: z.string().uuid().nullable().optional(),
  titleId: z.string().uuid().nullable().optional(),
  /** Only rows whose link disagrees with parser output. */
  mismatchOnly: z.boolean().default(false),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
});

export const listUnassignedEpisodes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ListInput.parse(d))
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let q = supabaseAdmin
      .from("media_files")
      .select(
        "id, title_id, channel_id, episode_id, file_name, caption, created_at, episodes(episode_number, seasons(season_number))",
        { count: "exact" },
      )
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);

    if (data.channelId) q = q.eq("channel_id", data.channelId);
    if (data.titleId) q = q.eq("title_id", data.titleId);
    if (!data.mismatchOnly) q = q.is("episode_id", null);

    const { data: rows, count, error } = await q;
    if (error) throw new Error(error.message);

    const titleIds = Array.from(new Set((rows ?? []).map((r: any) => r.title_id).filter(Boolean)));
    let titleMap = new Map<string, string>();
    if (titleIds.length) {
      const { data: titles } = await supabaseAdmin
        .from("master_titles")
        .select("id, title")
        .in("id", titleIds);
      for (const t of (titles as any[]) ?? []) titleMap.set(t.id, t.title);
    }

    const items = (rows ?? []).map((r: any) => {
      const parsed = parseMedia(r.caption, r.file_name);
      const encoded =
        parsed.season != null && parsed.episode != null
          ? (parsed.part != null ? parsed.part * 100 + parsed.episode : parsed.episode)
          : null;
      const currentSeason = r.episodes?.seasons?.season_number ?? null;
      const currentEpisodeRaw = r.episodes?.episode_number ?? null;
      // Decode the part out of the stored episode_number (part*100 + ep).
      const currentPart =
        typeof currentEpisodeRaw === "number" && currentEpisodeRaw >= 100
          ? Math.floor(currentEpisodeRaw / 100)
          : null;
      const currentEpisode =
        typeof currentEpisodeRaw === "number" && currentEpisodeRaw >= 100
          ? currentEpisodeRaw % 100
          : currentEpisodeRaw;
      const mismatch =
        parsed.season != null &&
        encoded != null &&
        (currentSeason !== parsed.season || currentEpisodeRaw !== encoded);
      // Specifically: parser found a part, DB grouping doesn't agree on the part.
      const partMismatch =
        parsed.part != null && currentPart !== parsed.part;
      return {
        id: r.id,
        title_id: r.title_id,
        title: titleMap.get(r.title_id) ?? null,
        channel_id: r.channel_id,
        file_name: r.file_name,
        caption: r.caption,
        current: {
          season: currentSeason,
          part: currentPart,
          episode: currentEpisode,
          episode_id: r.episode_id,
        },
        expected: {
          season: parsed.season,
          part: parsed.part,
          episode: parsed.episode,
          encoded_episode: encoded,
        },
        mismatch,
        partMismatch,
        actionable: parsed.season != null && parsed.episode != null,
      };
    });

    const filtered = data.mismatchOnly ? items.filter((i) => i.mismatch || i.partMismatch) : items;

    return { items: filtered, total: count ?? filtered.length };
  });

// -------------------- 3. On-demand reparse for channel/title --------------------

const ScopeInput = z.object({
  channelId: z.string().uuid().nullable().optional(),
  titleId: z.string().uuid().nullable().optional(),
  mediaFileIds: z.array(z.string().uuid()).max(500).optional(),
  dryRun: z.boolean().default(false),
});

export const reparseScope = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ScopeInput.parse(d))
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    if (!data.channelId && !data.titleId && (!data.mediaFileIds || data.mediaFileIds.length === 0)) {
      throw new Error("Provide channelId, titleId, or mediaFileIds");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Pull candidate media_files for the scope.
    let q = supabaseAdmin
      .from("media_files")
      .select("id, title_id, channel_id, caption, file_name, episode_id")
      .eq("is_active", true)
      .limit(1000);
    if (data.channelId) q = q.eq("channel_id", data.channelId);
    if (data.titleId) q = q.eq("title_id", data.titleId);
    if (data.mediaFileIds?.length) q = q.in("id", data.mediaFileIds);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    let scanned = 0;
    let relinked = 0;
    let seasonsCreated = 0;
    let episodesCreated = 0;
    const changes: Array<{
      media_file_id: string;
      title_id: string;
      before: { season: number | null; episode: number | null };
      after: { season: number; part: number | null; episode: number; encoded: number };
      caption_or_file: string;
    }> = [];

    for (const r of (rows as any[]) ?? []) {
      scanned++;
      if (!r.title_id) continue;
      const parsed = parseMedia(r.caption, r.file_name);
      if (parsed.season == null || parsed.episode == null) continue;
      const encoded = parsed.part != null ? parsed.part * 100 + parsed.episode : parsed.episode;

      // Discover current season/episode for "before".
      let beforeSeason: number | null = null;
      let beforeEpisode: number | null = null;
      if (r.episode_id) {
        const { data: cur } = await supabaseAdmin
          .from("episodes")
          .select("episode_number, seasons(season_number)")
          .eq("id", r.episode_id)
          .maybeSingle();
        beforeSeason = (cur as any)?.seasons?.season_number ?? null;
        beforeEpisode = (cur as any)?.episode_number ?? null;
      }
      if (beforeSeason === parsed.season && beforeEpisode === encoded) continue;

      changes.push({
        media_file_id: r.id,
        title_id: r.title_id,
        before: { season: beforeSeason, episode: beforeEpisode },
        after: { season: parsed.season, part: parsed.part, episode: parsed.episode, encoded },
        caption_or_file: (r.caption ?? r.file_name ?? "").slice(0, 160),
      });

      if (data.dryRun) continue;

      // Ensure season exists.
      let seasonId: string | null = null;
      const { data: existingSeason } = await supabaseAdmin
        .from("seasons")
        .select("id")
        .eq("title_id", r.title_id)
        .eq("season_number", parsed.season)
        .maybeSingle();
      if ((existingSeason as any)?.id) {
        seasonId = (existingSeason as any).id;
      } else {
        const { data: ins } = await supabaseAdmin
          .from("seasons")
          .insert({ title_id: r.title_id, season_number: parsed.season, name: `Season ${parsed.season}` })
          .select("id")
          .single();
        seasonId = (ins as any)?.id ?? null;
        if (seasonId) seasonsCreated++;
      }
      if (!seasonId) continue;

      // Ensure episode exists.
      let episodeId: string | null = null;
      const { data: existingEp } = await supabaseAdmin
        .from("episodes")
        .select("id")
        .eq("title_id", r.title_id)
        .eq("season_id", seasonId)
        .eq("episode_number", encoded)
        .maybeSingle();
      if ((existingEp as any)?.id) {
        episodeId = (existingEp as any).id;
      } else {
        const { data: ins } = await supabaseAdmin
          .from("episodes")
          .insert({
            title_id: r.title_id,
            season_id: seasonId,
            episode_number: encoded,
            name:
              parsed.part != null
                ? `Part ${parsed.part} — Episode ${parsed.episode}`
                : `Episode ${parsed.episode}`,
          })
          .select("id")
          .single();
        episodeId = (ins as any)?.id ?? null;
        if (episodeId) episodesCreated++;
      }
      if (!episodeId) continue;

      await supabaseAdmin
        .from("media_files")
        .update({ episode_id: episodeId })
        .eq("id", r.id);
      relinked++;
    }

    return {
      ok: true,
      dryRun: data.dryRun,
      scanned,
      changes_count: changes.length,
      relinked_files: relinked,
      seasons_created: seasonsCreated,
      episodes_created: episodesCreated,
      sample: changes.slice(0, 50),
    };
  });
