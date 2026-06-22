import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Inbox,
  RefreshCw,
  Send,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  getTelegramSyncHealth,
  getTelegramSyncTimeline,
  retrySyncChannel,
  runTelegramSyncHealthEval,
  getTelegramSyncAttempts,
} from "@/lib/telegram-sync-health.functions";

export const Route = createFileRoute("/_authenticated/admin/telegram-health")({
  component: TelegramHealthPage,
  head: () => ({ meta: [{ title: "Telegram sync health" }] }),
});

function fmtSec(sec: number | null) {
  if (sec === null) return "—";
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
}

function StatusPill({ status }: { status: "ok" | "warn" | "error" | "stalled" | "unknown" }) {
  const map: Record<string, { label: string; cls: string; Icon: any }> = {
    ok: { label: "Healthy", cls: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30", Icon: CheckCircle2 },
    warn: { label: "Degraded", cls: "bg-amber-500/15 text-amber-500 border-amber-500/30", Icon: AlertTriangle },
    error: { label: "Failing", cls: "bg-destructive/15 text-destructive border-destructive/30", Icon: XCircle },
    stalled: { label: "Stalled", cls: "bg-amber-500/15 text-amber-500 border-amber-500/30", Icon: Clock },
    unknown: { label: "Unknown", cls: "bg-muted text-muted-foreground border-border", Icon: Activity },
  };
  const { label, cls, Icon } = map[status] ?? map.unknown;
  return (
    <Badge variant="outline" className={cls + " gap-1"}>
      <Icon className="h-3 w-3" />
      {label}
    </Badge>
  );
}

function TelegramHealthPage() {
  const healthFn = useServerFn(getTelegramSyncHealth);
  const timelineFn = useServerFn(getTelegramSyncTimeline);
  const retryFn = useServerFn(retrySyncChannel);
  const evalFn = useServerFn(runTelegramSyncHealthEval);
  const attemptsFn = useServerFn(getTelegramSyncAttempts);
  const qc = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<"all" | "error" | "ok">("all");
  const [runIdFilter, setRunIdFilter] = useState<string | undefined>(undefined);

  const health = useQuery({
    queryKey: ["telegram-sync-health"],
    queryFn: () => healthFn(),
    refetchInterval: 30_000,
  });
  const timeline = useQuery({
    queryKey: ["telegram-sync-timeline", statusFilter, runIdFilter ?? ""],
    queryFn: () => timelineFn({ data: { limit: 100, statusFilter, runId: runIdFilter } }),
    refetchInterval: runIdFilter ? false : 30_000,
  });
  const attempts = useQuery({
    queryKey: ["telegram-sync-attempts"],
    queryFn: () => attemptsFn({ data: { limit: 15 } }),
    refetchInterval: 30_000,
  });

  const retry = useMutation({
    mutationFn: (channelRowId?: string) => retryFn({ data: { channelRowId } }),
    onSuccess: (r) => {
      toast.success(
        `Retry complete · processed ${r.processed} · ingested ${r.ingested} · skipped ${r.skipped}` +
          (r.errors ? ` · ${r.errors} errors` : ""),
      );
      qc.invalidateQueries({ queryKey: ["telegram-sync-health"] });
      qc.invalidateQueries({ queryKey: ["telegram-sync-timeline"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Retry failed"),
  });

  const evalAlerts = useMutation({
    mutationFn: () => evalFn(),
    onSuccess: (r) => {
      if (r.anomaly) toast.warning(`Anomaly detected: ${r.subject ?? r.kind}`);
      else toast.success("No anomalies — alerts resolved.");
      qc.invalidateQueries({ queryKey: ["telegram-sync-health"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Eval failed"),
  });

  const h = health.data;
  const summaryStatus: "ok" | "warn" | "error" | "stalled" | "unknown" = useMemo(() => {
    if (!h) return "unknown";
    if (h.consecutiveFailures >= h.thresholds.failingStreak) return "error";
    if (h.spike) return "error";
    if (h.stale) return "stalled";
    if (h.bot?.last_run_status === "error") return "warn";
    return "ok";
  }, [h]);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Send className="h-6 w-6" /> Telegram sync health
          </h1>
          <p className="text-sm text-muted-foreground">
            Live status of the channel scanner, error timeline, and retry controls.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              health.refetch();
              timeline.refetch();
            }}
          >
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={evalAlerts.isPending}
            onClick={() => evalAlerts.mutate()}
          >
            <AlertTriangle className="h-4 w-4 mr-1" /> Evaluate alerts now
          </Button>
          <Button
            size="sm"
            disabled={retry.isPending}
            onClick={() => retry.mutate(undefined)}
          >
            <RefreshCw className={"h-4 w-4 mr-1 " + (retry.isPending ? "animate-spin" : "")} />
            Retry all channels
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase text-muted-foreground">Status</CardTitle>
          </CardHeader>
          <CardContent>
            {health.isLoading ? (
              <Skeleton className="h-6 w-24" />
            ) : (
              <div className="space-y-1">
                <StatusPill status={summaryStatus} />
                <div className="text-xs text-muted-foreground">
                  Streak: {h?.consecutiveFailures ?? 0} / {h?.thresholds.failingStreak ?? 3}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase text-muted-foreground">Last sync</CardTitle>
          </CardHeader>
          <CardContent>
            {health.isLoading ? (
              <Skeleton className="h-6 w-32" />
            ) : (
              <div>
                <div className="text-lg font-semibold">
                  {fmtSec(
                    h?.bot?.last_run_at
                      ? Math.round((Date.now() - new Date(h.bot.last_run_at).getTime()) / 1000)
                      : null,
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {h?.bot?.last_run_status ?? "—"}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase text-muted-foreground">Backlog</CardTitle>
          </CardHeader>
          <CardContent>
            {health.isLoading ? (
              <Skeleton className="h-6 w-20" />
            ) : (
              <div>
                <div className="text-lg font-semibold flex items-center gap-1">
                  <Inbox className="h-4 w-4" /> {h?.backlog.unmatched ?? 0}
                </div>
                <div className="text-xs text-muted-foreground">unmatched ingest rows</div>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase text-muted-foreground">Errors (24h)</CardTitle>
          </CardHeader>
          <CardContent>
            {health.isLoading ? (
              <Skeleton className="h-6 w-20" />
            ) : (
              <div>
                <div className="text-lg font-semibold">{h?.backlog.errors24h ?? 0}</div>
                <div className="text-xs text-muted-foreground">
                  Rate (1h): {((h?.errorRate1h ?? 0) * 100).toFixed(0)}%
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Last error banner */}
      {h?.lastError && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-destructive">
              <XCircle className="h-4 w-4" /> Most recent failure
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <div>
              <span className="text-muted-foreground">Step:</span>{" "}
              <code className="text-xs">{h.lastError.step}</code>
            </div>
            <div>
              <span className="text-muted-foreground">Code:</span>{" "}
              <code className="text-xs">{h.lastError.error_code ?? "—"}</code>
            </div>
            <div>
              <span className="text-muted-foreground">Message:</span>{" "}
              <span className="text-xs">{h.lastError.error_message ?? "—"}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {new Date(h.lastError.created_at).toLocaleString()}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Channels */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Channels</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2">Name</th>
                  <th className="text-left px-3 py-2">Channel ID</th>
                  <th className="text-left px-3 py-2">Active</th>
                  <th className="text-left px-3 py-2">Last synced</th>
                  <th className="text-left px-3 py-2">Backfill</th>
                  <th className="text-right px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {(h?.channels ?? []).map((c: any) => {
                  const age = c.last_synced_at
                    ? Math.round((Date.now() - new Date(c.last_synced_at).getTime()) / 1000)
                    : null;
                  return (
                    <tr key={c.id} className="border-t border-border">
                      <td className="px-3 py-2">
                        <div className="font-medium">{c.name ?? "—"}</div>
                        {c.username && <div className="text-xs text-muted-foreground">@{c.username}</div>}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{c.channel_id}</td>
                      <td className="px-3 py-2">
                        {c.is_active ? <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/30">on</Badge> : <Badge variant="outline">off</Badge>}
                      </td>
                      <td className="px-3 py-2 text-xs">{fmtSec(age)}</td>
                      <td className="px-3 py-2 text-xs">{c.backfill_status ?? "—"}</td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={retry.isPending}
                          onClick={() => retry.mutate(c.id)}
                        >
                          <RefreshCw className={"h-3 w-3 mr-1 " + (retry.isPending ? "animate-spin" : "")} />
                          Retry sync
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                {(!h?.channels || h.channels.length === 0) && (
                  <tr>
                    <td colSpan={6} className="text-center text-muted-foreground text-sm py-6">
                      No channels configured.{" "}
                      <Link to="/admin/telegram" className="text-primary underline">
                        Add one in Telegram admin
                      </Link>
                      .
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Recent run summaries */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="text-base">Recent sync attempts</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Last {attempts.data?.runs.length ?? 0} runs · current error streak:{" "}
              <span className={(attempts.data?.streak ?? 0) > 0 ? "text-destructive font-semibold" : "text-emerald-500 font-semibold"}>
                {attempts.data?.streak ?? 0}
              </span>{" · "}
              backlog (unmatched): <span className="font-semibold">{attempts.data?.backlogUnmatched ?? 0}</span>
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => attempts.refetch()}>
            <RefreshCw className="h-3 w-3 mr-1" /> Refresh
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2">When</th>
                  <th className="text-left px-3 py-2">Source</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-right px-3 py-2">Steps</th>
                  <th className="text-right px-3 py-2">Ingested</th>
                  <th className="text-right px-3 py-2">Errors</th>
                  <th className="text-left px-3 py-2">Notes</th>
                  <th className="text-right px-3 py-2">Details</th>
                </tr>
              </thead>
              <tbody>
                {(attempts.data?.runs ?? []).map((r) => {
                  const pill: "ok" | "error" | "warn" =
                    r.overallStatus === "error" ? "error" :
                    r.overallStatus === "ok" || r.overallStatus === "skipped" ? "ok" : "warn";
                  return (
                    <tr key={r.runId} className="border-t border-border">
                      <td className="px-3 py-2 text-xs whitespace-nowrap">
                        {new Date(r.endedAt).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-xs">{r.source}</td>
                      <td className="px-3 py-2">
                        <StatusPill status={pill} />
                        {r.skipped && (
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            skipped: {r.skipReason ?? "—"}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-right">{r.stepCount}</td>
                      <td className="px-3 py-2 text-xs text-right">{r.ingestCount}</td>
                      <td className={"px-3 py-2 text-xs text-right " + (r.errorCount > 0 ? "text-destructive font-semibold" : "")}>{r.errorCount}</td>
                      <td className="px-3 py-2 text-xs max-w-xs truncate" title={r.fetchErrorMessage ?? undefined}>
                        {r.fetchErrorCode ? <code className="text-destructive text-[11px]">{r.fetchErrorCode}</code> : ""}
                        {r.fetchErrorMessage ? <span className="ml-1">{r.fetchErrorMessage}</span> : ""}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          size="sm"
                          variant={runIdFilter === r.runId ? "default" : "outline"}
                          onClick={() => {
                            setRunIdFilter(runIdFilter === r.runId ? undefined : r.runId);
                            setStatusFilter("all");
                          }}
                        >
                          {runIdFilter === r.runId ? "Showing" : "View"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                {(!attempts.data || attempts.data.runs.length === 0) && (
                  <tr><td colSpan={8} className="text-center text-muted-foreground text-sm py-6">No recent runs.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Timeline */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="text-base">Sync step timeline</CardTitle>
            {runIdFilter && (
              <p className="text-xs text-muted-foreground mt-1">
                Filtered to run <code className="text-[11px]">{runIdFilter.slice(0, 8)}…</code>{" "}
                <button className="text-primary underline" onClick={() => setRunIdFilter(undefined)}>
                  clear
                </button>
              </p>
            )}
          </div>
          <div className="flex gap-1">
            {(["all", "error", "ok"] as const).map((s) => (
              <Button
                key={s}
                size="sm"
                variant={statusFilter === s ? "default" : "outline"}
                onClick={() => setStatusFilter(s)}
              >
                {s}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2">When</th>
                  <th className="text-left px-3 py-2">Source</th>
                  <th className="text-left px-3 py-2">Step</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2">Latency</th>
                  <th className="text-left px-3 py-2">Error</th>
                  <th className="text-left px-3 py-2">Channel</th>
                </tr>
              </thead>
              <tbody>
                {(timeline.data ?? []).map((r: any) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="px-3 py-2 text-xs">{r.source}</td>
                    <td className="px-3 py-2 text-xs"><code>{r.step}</code></td>
                    <td className="px-3 py-2">
                      <StatusPill status={r.status === "ok" ? "ok" : r.status === "error" ? "error" : "warn"} />
                    </td>
                    <td className="px-3 py-2 text-xs">{r.latency_ms != null ? `${r.latency_ms}ms` : "—"}</td>
                    <td className="px-3 py-2 text-xs max-w-md truncate" title={r.error_message ?? undefined}>
                      {r.error_code ? <code className="text-destructive">{r.error_code}</code> : ""}
                      {r.error_message ? ` · ${r.error_message}` : ""}
                    </td>
                    <td className="px-3 py-2 text-xs font-mono">{r.channel_id ?? "—"}</td>
                  </tr>
                ))}
                {(!timeline.data || timeline.data.length === 0) && (
                  <tr>
                    <td colSpan={7} className="text-center text-muted-foreground text-sm py-6">
                      No sync steps recorded yet. Trigger a retry above to populate the timeline.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Public status endpoint: <code>/api/public/health/telegram-sync</code> · Alerts cron:{" "}
        <code>/api/public/hooks/telegram-sync-alerts</code>
      </p>
    </div>
  );
}
