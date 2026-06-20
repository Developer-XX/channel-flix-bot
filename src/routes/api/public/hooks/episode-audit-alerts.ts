// Cron endpoint: scans media_files & telegram_ingest for unassigned-episode
// regressions per channel and opens admin alerts when thresholds breach.
// Authenticated via the Supabase anon apikey header.
import { createFileRoute } from "@tanstack/react-router";
import { openAdminAlert, resolveAdminAlerts, recordCronRun } from "@/lib/audit.server";
import { parseMedia } from "@/lib/telegram-parser";

const JOB_NAME = "episode-audit-alerts";
const UNASSIGNED_THRESHOLD = 10; // open alert if ≥10 unassigned in a channel
const PARSE_FAIL_THRESHOLD = 10; // open alert if ≥10 parse-no-episode in 14d
const PART_MISMATCH_THRESHOLD = 5; // open alert if ≥5 SxxPyy files are mis-grouped

function authorize(request: Request): Response | null {
  const apikey = request.headers.get("apikey") ?? request.headers.get("x-cron-key");
  if (!apikey || apikey !== process.env.SUPABASE_PUBLISHABLE_KEY) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}

export const Route = createFileRoute("/api/public/hooks/episode-audit-alerts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = authorize(request);
        if (denied) return denied;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const start = Date.now();

        try {
          // Files: unassigned per channel + SxxPyy mis-grouping per channel.
          const { data: files } = await supabaseAdmin
            .from("media_files")
            .select(
              "channel_id, episode_id, caption, file_name, episodes(episode_number, seasons(season_number))",
            )
            .eq("is_active", true);

          const unassignedByCh = new Map<string, number>();
          const partMismatchByCh = new Map<string, number>();
          for (const f of (files as any[]) ?? []) {
            if (!f.channel_id) continue;
            if (!f.episode_id) {
              unassignedByCh.set(f.channel_id, (unassignedByCh.get(f.channel_id) ?? 0) + 1);
              continue;
            }
            // Compare parser expectation vs current grouping for part-bearing files.
            const text = `${f.caption ?? ""} ${f.file_name ?? ""}`;
            if (!/\bS\d{1,2}[\s._-]?P/i.test(text) && !/\bPart[\s._-]?\d/i.test(text)) continue;
            const parsed = parseMedia(f.caption, f.file_name);
            if (parsed.part == null || parsed.season == null || parsed.episode == null) continue;
            const expectedEnc = parsed.part * 100 + parsed.episode;
            const curSeason = f.episodes?.seasons?.season_number ?? null;
            const curEp = f.episodes?.episode_number ?? null;
            if (curSeason !== parsed.season || curEp !== expectedEnc) {
              partMismatchByCh.set(f.channel_id, (partMismatchByCh.get(f.channel_id) ?? 0) + 1);
            }
          }

          // Ingest: parse-no-episode per channel (last 14d)
          const since = new Date(Date.now() - 14 * 24 * 3600_000).toISOString();
          const { data: ingestRows } = await supabaseAdmin
            .from("telegram_ingest")
            .select("channel_id, caption, file_name")
            .gt("created_at", since);

          const parseFailByCh = new Map<string, number>();
          for (const ir of (ingestRows as any[]) ?? []) {
            if (!ir.channel_id) continue;
            const text = `${ir.caption ?? ""} ${ir.file_name ?? ""}`;
            if (!/\b(S\d{1,2}|Season|Episode|EP\b)/i.test(text)) continue;
            const p = parseMedia(ir.caption, ir.file_name);
            if (p.episode == null) {
              parseFailByCh.set(ir.channel_id, (parseFailByCh.get(ir.channel_id) ?? 0) + 1);
            }
          }

          const { data: channels } = await supabaseAdmin
            .from("telegram_channels")
            .select("id, name");
          const chName = new Map<string, string>();
          for (const c of (channels as any[]) ?? []) chName.set(c.id, c.name);

          const openedSubjects = new Set<string>();
          let alertsOpened = 0;

          for (const [chId, count] of unassignedByCh) {
            if (count >= UNASSIGNED_THRESHOLD) {
              const subject = `Unassigned episodes: ${chName.get(chId) ?? chId}`;
              await openAdminAlert(supabaseAdmin as any, {
                kind: "episode_unassigned",
                severity: count >= UNASSIGNED_THRESHOLD * 5 ? "error" : "warn",
                subject,
                source: JOB_NAME,
                details: { channel_id: chId, channel_name: chName.get(chId), unassigned: count },
              });
              openedSubjects.add(subject);
              alertsOpened++;
            }
          }

          for (const [chId, count] of parseFailByCh) {
            if (count >= PARSE_FAIL_THRESHOLD) {
              const subject = `Parse failures: ${chName.get(chId) ?? chId}`;
              await openAdminAlert(supabaseAdmin as any, {
                kind: "episode_parse_fail",
                severity: count >= PARSE_FAIL_THRESHOLD * 5 ? "error" : "warn",
                subject,
                source: JOB_NAME,
                details: { channel_id: chId, channel_name: chName.get(chId), parse_failures: count, window: "14d" },
              });
              openedSubjects.add(subject);
              alertsOpened++;
            }
          }

          for (const [chId, count] of partMismatchByCh) {
            if (count >= PART_MISMATCH_THRESHOLD) {
              const subject = `Part/season mis-grouping: ${chName.get(chId) ?? chId}`;
              await openAdminAlert(supabaseAdmin as any, {
                kind: "episode_part_mismatch",
                severity: count >= PART_MISMATCH_THRESHOLD * 5 ? "error" : "warn",
                subject,
                source: JOB_NAME,
                details: {
                  channel_id: chId,
                  channel_name: chName.get(chId),
                  mismatches: count,
                  pattern: "SxxPyy / Part",
                  hint: "Run admin → Episode audit → Reparse for this channel.",
                },
              });
              openedSubjects.add(subject);
              alertsOpened++;
            }
          }

          // Resolve previously-open alerts that are now below threshold.
          const { data: openAlerts } = await supabaseAdmin
            .from("admin_alerts")
            .select("id, kind, subject")
            .in("kind", ["episode_unassigned", "episode_parse_fail", "episode_part_mismatch"])
            .is("resolved_at", null);
          let resolved = 0;
          for (const a of (openAlerts as any[]) ?? []) {
            if (!openedSubjects.has(a.subject)) {
              await resolveAdminAlerts(supabaseAdmin as any, a.kind, a.subject);
              resolved++;
            }
          }

          const summary = {
            channels_unassigned: unassignedByCh.size,
            channels_parse_fail: parseFailByCh.size,
            channels_part_mismatch: partMismatchByCh.size,
            alerts_opened: alertsOpened,
            alerts_resolved: resolved,
            duration_ms: Date.now() - start,
          };
          await recordCronRun(supabaseAdmin as any, JOB_NAME, true, summary);
          return Response.json({ ok: true, ...summary });
        } catch (e: any) {
          await recordCronRun(supabaseAdmin as any, JOB_NAME, false, {}, e?.message ?? String(e));
          return Response.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
        }
      },
    },
  },
});
