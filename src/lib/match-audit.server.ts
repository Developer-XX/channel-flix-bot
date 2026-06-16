// Persist every match attempt so admins can later see exactly why a file did
// or didn't end up on the website. Server-only — writes are best-effort and
// never throw to the caller (audit failure must not break ingestion).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MatcherResult, MatchingSettings } from "@/lib/telegram-ingest.server";

export type AuditDecision = "promoted" | "rejected" | "manual" | "alias" | "skipped";

export async function writeMatchAudit(
  supabase: SupabaseClient<any, any, any>,
  args: {
    ingestId: string | null;
    titleId: string | null;
    match?: MatcherResult | null;
    settings?: MatchingSettings | null;
    decision: AuditDecision;
    reason: string;
    actor?: string;
    parsedSnapshot?: Record<string, unknown> | null;
  },
): Promise<void> {
  try {
    const top = args.match?.candidates?.[0];
    const scores = {
      total: args.match?.matchScore ?? null,
      via: args.match?.matchedVia ?? null,
      top: top
        ? {
            titleId: top.titleId,
            title: top.title,
            jaccard: top.parts.jaccard,
            containment: top.parts.containment,
            substring: top.parts.substring,
            adjusted: top.adjustedScore,
            yearOk: top.yearOk,
            categoryOk: top.categoryOk,
          }
        : null,
      aliasHits: args.match?.aliasHits ?? [],
    };
    await supabase.from("match_audit_log").insert({
      telegram_ingest_id: args.ingestId,
      master_title_id: args.titleId,
      scores,
      rules_used: (args.settings ?? {}) as any,
      threshold: args.settings?.threshold ?? null,
      decision: args.decision,
      reason: args.reason,
      actor: args.actor ?? "auto",
      parsed_snapshot: args.parsedSnapshot ?? null,
    });
  } catch (e) {
    console.warn("[match-audit] write failed:", (e as Error).message);
  }
}
