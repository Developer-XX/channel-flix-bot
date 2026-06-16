import { createFileRoute } from "@tanstack/react-router";
import { parseMedia, normalizeTitle, titleSimilarity } from "@/lib/telegram-parser";

// Telegram channel-post webhook receiver.
// Security: Telegram is configured with a `secret_token`; it sends it back in
// the `X-Telegram-Bot-Api-Secret-Token` header on every request.

const MATCH_THRESHOLD = 0.55;

function extractFile(message: any): {
  file_id: string | null;
  file_unique_id: string | null;
  file_name: string | null;
  mime_type: string | null;
  file_size: number | null;
  duration_seconds: number | null;
} {
  if (!message) return { file_id: null, file_unique_id: null, file_name: null, mime_type: null, file_size: null, duration_seconds: null };
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
  return { file_id: null, file_unique_id: null, file_name: null, mime_type: null, file_size: null, duration_seconds: null };
}

export const Route = createFileRoute("/api/public/telegram/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
        if (!expectedSecret) {
          return new Response("Webhook secret not configured", { status: 500 });
        }
        const provided = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
        if (provided !== expectedSecret) {
          return new Response("Unauthorized", { status: 401 });
        }

        let update: any;
        try {
          update = await request.json();
        } catch {
          return new Response("Bad request", { status: 400 });
        }

        const message = update.channel_post ?? update.edited_channel_post ?? update.message ?? update.edited_message;
        if (!message?.chat?.id || typeof update.update_id !== "number") {
          return Response.json({ ok: true, ignored: true });
        }

        const tgChannelId: number = message.chat.id;
        const tgMessageId: number = message.message_id;
        const caption: string | null = message.caption ?? message.text ?? null;
        const file = extractFile(message);

        // Only ingest posts that carry a media file
        if (!file.file_id) {
          return Response.json({ ok: true, ignored: "no_file" });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Find tracked channel row (optional)
        const { data: chanRow } = await supabaseAdmin
          .from("telegram_channels")
          .select("id, is_active")
          .eq("channel_id", tgChannelId)
          .maybeSingle();
        if (chanRow && chanRow.is_active === false) {
          return Response.json({ ok: true, ignored: "channel_inactive" });
        }

        const parsed = parseMedia(caption, file.file_name);

        // Fuzzy match against published master_titles
        let matchedTitleId: string | null = null;
        let matchScore: number | null = null;
        const normalized = normalizeTitle(parsed.title);
        if (normalized) {
          const { data: candidates } = await supabaseAdmin
            .from("master_titles")
            .select("id, title, release_year")
            .ilike("title", `%${normalized.split(" ")[0]}%`)
            .limit(25);
          for (const c of candidates ?? []) {
            const score = titleSimilarity(parsed.title, c.title);
            const yearOk = !parsed.year || !c.release_year || Math.abs(parsed.year - c.release_year) <= 1;
            const adj = yearOk ? score : score * 0.6;
            if (matchScore === null || adj > matchScore) {
              matchScore = adj;
              if (adj >= MATCH_THRESHOLD) matchedTitleId = c.id;
            }
          }
        }

        const status = matchedTitleId ? "matched" : "unmatched";

        const { error: ingestErr } = await supabaseAdmin
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
              match_status: status,
              matched_title_id: matchedTitleId,
              match_score: matchScore,
              raw_update: update,
            },
            { onConflict: "telegram_channel_id,telegram_message_id" },
          );

        if (ingestErr) {
          console.error("[telegram-webhook] ingest error", ingestErr);
          return Response.json({ ok: false, error: ingestErr.message }, { status: 500 });
        }

        if (chanRow?.id) {
          await supabaseAdmin
            .from("telegram_channels")
            .update({ last_synced_at: new Date().toISOString() })
            .eq("id", chanRow.id);
        }

        return Response.json({ ok: true, matched: !!matchedTitleId, score: matchScore });
      },
    },
  },
});
