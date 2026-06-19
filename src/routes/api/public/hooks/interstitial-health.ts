// Cron-triggered interstitial health monitor.
// Evaluates rolling 15-minute windows of ad_perf_events per placement and
// opens/resolves admin_alerts (with throttled Telegram DMs to admins) for:
//   - video_error rate > 10%
//   - autoplay_blocked rate > 40%
//   - ttff_ms p75 > 3500ms OR >= 1.5x of 24h baseline p75
//
// Requires >= 50 events in the window before evaluating (avoids alert flap
// on low-traffic periods).

import { createFileRoute } from "@tanstack/react-router";

const WINDOW_MIN = 15;
const MIN_SAMPLES = 50;
const VIDEO_ERROR_RATE_MAX = 0.10;
const AUTOPLAY_BLOCKED_RATE_MAX = 0.40;
const TTFF_P75_HARD_MS = 3500;
const TTFF_REGRESSION_RATIO = 1.5;

type Ev = { placement: string; metric: string; value: number };

function p75(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(0.75 * s.length))]);
}

function bucket(events: Ev[]): Map<
  string,
  { ttff: number[]; samples: number; errors: number; blocked: number }
> {
  const m = new Map<string, { ttff: number[]; samples: number; errors: number; blocked: number }>();
  for (const e of events) {
    let slot = m.get(e.placement);
    if (!slot) {
      slot = { ttff: [], samples: 0, errors: 0, blocked: 0 };
      m.set(e.placement, slot);
    }
    slot.samples += 1;
    if (e.metric === "ttff_ms") slot.ttff.push(Number(e.value) || 0);
    if (e.metric === "video_error") slot.errors += 1;
    if (e.metric === "autoplay_blocked") slot.blocked += 1;
  }
  return m;
}

export const Route = createFileRoute("/api/public/hooks/interstitial-health")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { checkCronAuth } = await import("@/lib/cron-auth.server");
        const auth = checkCronAuth(request);
        if (!auth.ok) return auth.response;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { openAdminAlert, resolveAdminAlerts, maybeNotifyAdminsTelegram, writeAudit, recordCronRun } =
          await import("@/lib/audit.server");

        const now = Date.now();
        const winSince = new Date(now - WINDOW_MIN * 60_000).toISOString();
        const baselineSince = new Date(now - 24 * 3600_000).toISOString();
        const baselineUntil = new Date(now - WINDOW_MIN * 60_000).toISOString();

        const winQ = supabaseAdmin
          .from("ad_perf_events")
          .select("placement,metric,value")
          .gte("created_at", winSince)
          .limit(20_000);
        const baseQ = supabaseAdmin
          .from("ad_perf_events")
          .select("placement,metric,value")
          .gte("created_at", baselineSince)
          .lt("created_at", baselineUntil)
          .eq("metric", "ttff_ms")
          .limit(50_000);

        const [winR, baseR] = await Promise.all([winQ, baseQ]);
        if (winR.error || baseR.error) {
          const err = (winR.error ?? baseR.error)!.message;
          await recordCronRun(supabaseAdmin as any, "interstitial-health", false, {}, err);
          return Response.json({ ok: false, error: err }, { status: 500 });
        }

        const win = bucket((winR.data ?? []) as Ev[]);
        const baselineByPlacement = new Map<string, number[]>();
        for (const e of (baseR.data ?? []) as Ev[]) {
          if (e.metric !== "ttff_ms") continue;
          const arr = baselineByPlacement.get(e.placement) ?? [];
          arr.push(Number(e.value) || 0);
          baselineByPlacement.set(e.placement, arr);
        }

        const findings: Array<{
          kind: string;
          subject: string;
          severity: "warn" | "error";
          fire: boolean;
          details: Record<string, unknown>;
          text: string;
        }> = [];

        for (const [placement, slot] of win) {
          if (slot.samples < MIN_SAMPLES) continue;

          const errorRate = slot.errors / slot.samples;
          const blockedRate = slot.blocked / slot.samples;
          const ttff = p75(slot.ttff);
          const baselineTtff = p75(baselineByPlacement.get(placement) ?? []);

          findings.push({
            kind: "interstitial_video_error_rate",
            subject: `interstitial ${placement} error rate`,
            severity: "error",
            fire: errorRate > VIDEO_ERROR_RATE_MAX,
            details: { placement, errorRate, errors: slot.errors, samples: slot.samples, window_min: WINDOW_MIN },
            text: `🚨 Interstitial <b>${placement}</b> error rate <b>${(errorRate * 100).toFixed(1)}%</b> (${slot.errors}/${slot.samples}) in last ${WINDOW_MIN}m. Threshold ${(VIDEO_ERROR_RATE_MAX * 100).toFixed(0)}%.`,
          });

          findings.push({
            kind: "interstitial_autoplay_blocked_rate",
            subject: `interstitial ${placement} autoplay blocked rate`,
            severity: "warn",
            fire: blockedRate > AUTOPLAY_BLOCKED_RATE_MAX,
            details: {
              placement,
              blockedRate,
              blocked: slot.blocked,
              samples: slot.samples,
              window_min: WINDOW_MIN,
            },
            text: `⚠️ Interstitial <b>${placement}</b> autoplay blocked <b>${(blockedRate * 100).toFixed(1)}%</b> (${slot.blocked}/${slot.samples}) in last ${WINDOW_MIN}m. Threshold ${(AUTOPLAY_BLOCKED_RATE_MAX * 100).toFixed(0)}%.`,
          });

          if (ttff != null) {
            const hardBreach = ttff > TTFF_P75_HARD_MS;
            const regressionBreach =
              baselineTtff != null && baselineTtff > 0 && ttff / baselineTtff >= TTFF_REGRESSION_RATIO;
            findings.push({
              kind: "interstitial_ttff_regression",
              subject: `interstitial ${placement} ttff p75`,
              severity: "warn",
              fire: hardBreach || regressionBreach,
              details: {
                placement,
                ttff_p75_ms: ttff,
                baseline_p75_ms: baselineTtff,
                ratio: baselineTtff ? ttff / baselineTtff : null,
                samples: slot.samples,
                window_min: WINDOW_MIN,
              },
              text: `🐌 Interstitial <b>${placement}</b> TTFF p75 <b>${ttff}ms</b>${baselineTtff ? ` vs baseline ${baselineTtff}ms (×${(ttff / baselineTtff).toFixed(2)})` : ""}. Threshold ${TTFF_P75_HARD_MS}ms / ×${TTFF_REGRESSION_RATIO}.`,
            });
          }
        }

        let opened = 0;
        let resolved = 0;
        for (const f of findings) {
          if (f.fire) {
            const id = await openAdminAlert(supabaseAdmin as any, {
              kind: f.kind,
              severity: f.severity,
              subject: f.subject,
              details: f.details,
              source: "interstitial-health",
            });
            opened += 1;
            await maybeNotifyAdminsTelegram(supabaseAdmin as any, {
              alertId: id,
              kind: f.kind,
              text: f.text,
            });
          } else {
            await resolveAdminAlerts(supabaseAdmin as any, f.kind, f.subject);
            resolved += 1;
          }
        }

        await writeAudit(supabaseAdmin as any, {
          action: "cron.interstitial_health.run",
          status: "success",
          metadata: {
            placements: [...win.keys()],
            findings: findings.length,
            opened,
            resolved,
          },
        });
        await recordCronRun(supabaseAdmin as any, "interstitial-health", true, {
          findings: findings.length,
          opened,
          resolved,
        });

        return Response.json({
          ok: true,
          findings: findings.length,
          opened,
          resolved,
          placements_evaluated: [...win.keys()],
        });
      },
    },
  },
});
