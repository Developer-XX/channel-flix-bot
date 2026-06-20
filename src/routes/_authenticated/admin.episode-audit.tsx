import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, RefreshCw, Wand2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getEpisodeAuditStats,
  listUnassignedEpisodes,
  reparseScope,
} from "@/lib/episode-audit.functions";

export const Route = createFileRoute("/_authenticated/admin/episode-audit")({
  component: EpisodeAuditPage,
});

function EpisodeAuditPage() {
  const statsFn = useServerFn(getEpisodeAuditStats);
  const listFn = useServerFn(listUnassignedEpisodes);
  const reparseFn = useServerFn(reparseScope);

  const [scope, setScope] = useState<{
    channelId: string | null;
    titleId: string | null;
  }>({ channelId: null, titleId: null });
  const [mismatchOnly, setMismatchOnly] = useState(false);
  const [busy, setBusy] = useState(false);

  const stats = useQuery({
    queryKey: ["episode-audit-stats"],
    queryFn: () => statsFn(),
    refetchInterval: 60_000,
  });

  const list = useQuery({
    queryKey: ["episode-audit-list", scope.channelId, scope.titleId, mismatchOnly],
    queryFn: () =>
      listFn({
        data: {
          channelId: scope.channelId,
          titleId: scope.titleId,
          mismatchOnly,
          limit: 200,
        },
      }),
  });

  async function runReparse(dryRun: boolean) {
    if (!scope.channelId && !scope.titleId) {
      toast.error("Set a channel or title scope first");
      return;
    }
    setBusy(true);
    try {
      const r = await reparseFn({ data: { ...scope, dryRun } });
      toast.success(
        `${dryRun ? "DRY RUN" : "Reparsed"}: ${r.changes_count} change(s), ${r.relinked_files} relinked, ${r.seasons_created} seasons + ${r.episodes_created} episodes created`,
      );
      list.refetch();
      stats.refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Reparse failed");
    } finally {
      setBusy(false);
    }
  }

  const totals = stats.data?.totals;

  return (
    <div className="p-6 max-w-6xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Episode audit</h1>
        <p className="text-sm text-muted-foreground">
          Find media files that aren't linked to an episode row (or are linked to the wrong one)
          and reparse them on demand. Encoding: <code>episode_number = part × 100 + episode</code>.
        </p>
      </header>

      {/* Per-channel stats */}
      <section className="rounded-xl border border-border overflow-hidden">
        <header className="px-4 py-2 bg-surface/60 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Per-channel health (last 14 days)</h2>
          <Button size="sm" variant="ghost" onClick={() => stats.refetch()} disabled={stats.isFetching}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${stats.isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </header>
        {stats.isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading…</div>
        ) : stats.error ? (
          <div
            data-testid="episode-audit-error-state"
            className="p-4 text-sm border-t border-destructive/40 bg-destructive/10 text-destructive"
          >
            <div className="font-semibold">Backend query failed</div>
            <div className="mt-1 text-xs opacity-90 break-all">{(stats.error as Error).message}</div>
          </div>
        ) : (stats.data?.rows ?? []).length === 0 ? (
          <div
            data-testid="episode-audit-empty-state"
            className="p-6 text-sm text-muted-foreground"
          >
            No channel activity in the last 14 days. This is an empty result,
            not an error — ingest some Telegram files and refresh.
          </div>
        ) : (

            {totals && (
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 p-3 text-xs">
                <Stat label="Total files" value={totals.total_files} />
                <Stat label="Unassigned" value={totals.unassigned} tone={totals.unassigned ? "warn" : undefined} />
                <Stat label="Ingest rows" value={totals.ingest_total} />
                <Stat label="Unmatched ingest" value={totals.ingest_unmatched} tone={totals.ingest_unmatched ? "warn" : undefined} />
                <Stat label="Failed ingest" value={totals.ingest_failed} tone={totals.ingest_failed ? "err" : undefined} />
                <Stat label="Parse: no episode" value={totals.parse_no_episode} tone={totals.parse_no_episode ? "warn" : undefined} />
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-surface/40">
                  <tr className="text-left">
                    <th className="px-3 py-2">Channel</th>
                    <th className="px-3 py-2 text-right">Files</th>
                    <th className="px-3 py-2 text-right">Unassigned</th>
                    <th className="px-3 py-2 text-right">Ingest</th>
                    <th className="px-3 py-2 text-right">Unmatched</th>
                    <th className="px-3 py-2 text-right">Failed</th>
                    <th className="px-3 py-2 text-right">No-episode parse</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(stats.data?.rows ?? []).map((r) => (
                    <tr key={r.channel_id ?? "_"} className="hover:bg-surface/30">
                      <td className="px-3 py-1.5">
                        <div className="font-medium truncate max-w-[200px]">{r.name}</div>
                        {r.username && <div className="text-[10px] text-muted-foreground">@{r.username}</div>}
                      </td>
                      <td className="px-3 py-1.5 text-right">{r.total_files}</td>
                      <td className={`px-3 py-1.5 text-right ${r.unassigned ? "text-amber-500 font-medium" : ""}`}>{r.unassigned}</td>
                      <td className="px-3 py-1.5 text-right">{r.ingest_total}</td>
                      <td className={`px-3 py-1.5 text-right ${r.ingest_unmatched ? "text-amber-500" : ""}`}>{r.ingest_unmatched}</td>
                      <td className={`px-3 py-1.5 text-right ${r.ingest_failed ? "text-destructive" : ""}`}>{r.ingest_failed}</td>
                      <td className={`px-3 py-1.5 text-right ${r.parse_no_episode ? "text-amber-500" : ""}`}>{r.parse_no_episode}</td>
                      <td className="px-3 py-1.5">
                        {r.channel_id && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setScope({ channelId: r.channel_id, titleId: null })}
                          >
                            <Search className="h-3 w-3 mr-1" /> Inspect
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* Scope + reparse controls */}
      <section className="rounded-xl border border-border p-4 space-y-3">
        <h2 className="text-sm font-semibold">Scope & reparse</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Channel ID (UUID)</Label>
            <Input
              value={scope.channelId ?? ""}
              onChange={(e) => setScope({ ...scope, channelId: e.target.value || null })}
              placeholder="leave blank for any"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Title ID (UUID)</Label>
            <Input
              value={scope.titleId ?? ""}
              onChange={(e) => setScope({ ...scope, titleId: e.target.value || null })}
              placeholder="leave blank for any"
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={mismatchOnly}
            onChange={(e) => setMismatchOnly(e.target.checked)}
          />
          Show mismatched only (parser disagrees with current link)
        </label>
        <div className="flex gap-2">
          <Button onClick={() => runReparse(true)} variant="outline" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Search className="h-4 w-4 mr-1" />}
            Dry run
          </Button>
          <Button onClick={() => runReparse(false)} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Wand2 className="h-4 w-4 mr-1" />}
            Reparse & relink now
          </Button>
        </div>
      </section>

      {/* Affected rows */}
      <section className="rounded-xl border border-border overflow-hidden">
        <header className="px-4 py-2 bg-surface/60 flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            {mismatchOnly ? "Mismatched" : "Unassigned"} files ({list.data?.items.length ?? 0})
          </h2>
          <Button size="sm" variant="ghost" onClick={() => list.refetch()}>
            <RefreshCw className={`h-3.5 w-3.5 ${list.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </header>
        {list.isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-surface/40 sticky top-0">
                <tr className="text-left">
                  <th className="px-3 py-2">Title</th>
                  <th className="px-3 py-2">File / caption</th>
                  <th className="px-3 py-2">Current</th>
                  <th className="px-3 py-2">Expected (parser)</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(list.data?.items ?? []).map((r) => (
                  <tr key={r.id} className="hover:bg-surface/30 align-top">
                    <td className="px-3 py-1.5 max-w-[200px] truncate">{r.title ?? "—"}</td>
                    <td className="px-3 py-1.5 max-w-[320px]">
                      <div className="truncate font-medium">{r.caption ?? r.file_name}</div>
                      {r.caption && (
                        <div className="text-[10px] text-muted-foreground truncate" title={r.file_name}>{r.file_name}</div>
                      )}
                    </td>
                    <td className="px-3 py-1.5 font-mono">
                      {r.current.season != null
                        ? `S${r.current.season}${r.current.part != null ? `P${r.current.part}` : ""} E${r.current.episode}`
                        : <span className="text-muted-foreground">unassigned</span>}
                    </td>
                    <td className="px-3 py-1.5 font-mono">
                      {r.expected.season != null && r.expected.episode != null
                        ? `S${r.expected.season}${r.expected.part != null ? `P${r.expected.part}` : ""}E${r.expected.episode} → ep_no=${r.expected.encoded_episode}`
                        : <span className="text-muted-foreground">unparseable</span>}
                    </td>
                    <td className="px-3 py-1.5">
                      {(r as any).partMismatch ? (
                        <span className="text-destructive">part mismatch</span>
                      ) : r.mismatch ? (
                        <span className="text-destructive">mismatch</span>
                      ) : !r.current.season ? (
                        r.actionable ? <span className="text-amber-500">fixable</span> : <span className="text-muted-foreground">no parse</span>
                      ) : (
                        <span className="text-emerald-500">ok</span>
                      )}
                    </td>
                  </tr>
                ))}
                {(list.data?.items ?? []).length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Nothing to show.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warn" | "err" }) {
  const color = tone === "err" ? "text-destructive" : tone === "warn" ? "text-amber-500" : "";
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={`text-lg font-semibold ${color}`}>{value}</div>
    </div>
  );
}
