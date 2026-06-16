import { createFileRoute } from "@tanstack/react-router";

// Periodic resync: re-runs the Telegram matcher across unpromoted ingest rows
// for titles updated in the last N hours. Wired to pg_cron so newly uploaded
// media appears on title pages without anyone clicking "Re-run Telegram sync".
//
// Auth: bypass-auth /api/public/* route. We still require the Supabase
// anon/publishable key in the `apikey` header so random callers can't trigger
// expensive work.
export const Route = createFileRoute("/api/public/hooks/telegram-resync-recent")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
        const provided = request.headers.get("apikey") ?? "";
        if (!expected || provided !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        const hoursStr = new URL(request.url).searchParams.get("hours");
        const hours = Math.max(1, Math.min(168, Number(hoursStr) || 24));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const {
          loadMatchingSettings,
          autoPromoteToMediaFile,
          bestTitleScore,
        } = await import("@/lib/telegram-ingest.server");
        const { bumpCacheVersion } = await import("@/lib/indexes.server");

        const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
        const { data: titles, error: titlesErr } = await supabaseAdmin
          .from("master_titles")
          .select("id, title, release_year, category")
          .gte("updated_at", since)
          .eq("status", "published")
          .limit(50);
        if (titlesErr) {
          console.error("[resync-recent] titles query failed", titlesErr);
          return Response.json({ ok: false, error: titlesErr.message }, { status: 500 });
        }

        const settings = await loadMatchingSettings(supabaseAdmin);
        let scannedTitles = 0;
        let promoted = 0;
        let skipped = 0;
        const errors: string[] = [];

        for (const t of titles ?? []) {
          scannedTitles++;
          const head = (t.title || "").split(/\s+/).filter((w: string) => w.length >= 3)[0] ?? t.title?.[0] ?? "";
          if (!head) continue;
          const { data: rows } = await supabaseAdmin
            .from("telegram_ingest")
            .select("*")
            .ilike("parsed_title", `%${head}%`)
            .is("promoted_media_file_id", null)
            .limit(100);
          for (const r of rows ?? []) {
            const { score } = bestTitleScore(r.parsed_title ?? "", t.title, settings);
            const yearOk = !r.parsed_year || !t.release_year ||
              Math.abs(r.parsed_year - t.release_year) <= settings.year_window;
            const categoryOk = !r.parsed_category || !t.category || r.parsed_category === t.category;
            let adjusted = score;
            if (!yearOk) adjusted *= 0.6;
            if (settings.require_category_match && !categoryOk) adjusted = 0;
            else if (!categoryOk) adjusted *= 0.85;
            if (adjusted < settings.threshold || !r.telegram_file_id) { skipped++; continue; }
            try {
              await autoPromoteToMediaFile(supabaseAdmin, {
                ingestId: r.id,
                titleId: t.id,
                channelRowId: r.channel_id,
                telegramFileId: r.telegram_file_id,
                telegramMessageId: r.telegram_message_id,
                fileName: r.file_name ?? r.parsed_title ?? "file",
                caption: r.caption,
                mimeType: r.mime_type,
                fileSize: r.file_size,
                durationSeconds: r.duration_seconds,
                quality: r.parsed_quality,
                resolution: r.parsed_resolution,
                language: r.parsed_language,
                season: r.parsed_season,
                episode: r.parsed_episode,
              });
              promoted++;
            } catch (e) { errors.push((e as Error).message); }
          }
        }

        if (promoted > 0) await bumpCacheVersion(supabaseAdmin);

        const summary = { ok: true, hours, scannedTitles, promoted, skipped, errors: errors.slice(0, 10) };
        console.log("[resync-recent]", JSON.stringify(summary));
        return Response.json(summary);
      },
    },
  },
});
