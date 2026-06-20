import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Loader2, Play, CheckCircle2, XCircle, AlertCircle, RotateCw, Download, Trash2 } from "lucide-react";
import { startBulkRematch, getBulkJobStatus, retryFailedFromJob, deleteBulkJobs } from "@/lib/bulk.functions";
import { reparseSeriesParts } from "@/lib/reparse-series.functions";
import {
  previewMessageDeletes,
  getDeleteCronMetrics,
  getReparseCronConfig,
  setReparseCronConfig,
} from "@/lib/admin-deletes.functions";
import { useQueryClient } from "@tanstack/react-query";


export const Route = createFileRoute("/_authenticated/admin/bulk")({
  component: BulkRematchPage,
});

const CATEGORIES = ["movie", "series", "anime", "documentary", "show"] as const;
type Cat = (typeof CATEGORIES)[number];

function BulkRematchPage() {
  const startFn = useServerFn(startBulkRematch);
  const statusFn = useServerFn(getBulkJobStatus);
  const retryFn = useServerFn(retryFailedFromJob);
  const deleteFn = useServerFn(deleteBulkJobs);
  const qc = useQueryClient();
  const [days, setDays] = useState(7);

  const [dryRun, setDryRun] = useState(false);
  const [cats, setCats] = useState<Set<Cat>>(new Set());
  const [jobId, setJobId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const job = useQuery({
    queryKey: ["bulk-job", jobId],
    queryFn: () => statusFn({ data: jobId ? { jobId } : {} }),
    refetchInterval: jobId ? 2000 : false,
    enabled: true,
  });

  const current: any = jobId ? (job.data as any)?.job : null;
  const recent: any[] = !jobId ? ((job.data as any)?.recent ?? []) : [];
  const pct =
    current && current.total > 0 ? Math.round((current.processed / current.total) * 100) : 0;
  const running = current?.status === "running";
  const results: any[] = current?.results ?? [];
  const stillUnmatched =
    typeof current?.params?.stillUnmatched === "number"
      ? current.params.stillUnmatched
      : results.filter((r) => r.decision === "still_unmatched").length;

  function toggleCat(c: Cat) {
    setCats((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }

  async function onStart() {
    setStarting(true);
    try {
      const r = await startFn({
        data: {
          days,
          dryRun,
          categories: cats.size > 0 ? (Array.from(cats) as Cat[]) : undefined,
        },
      });
      setJobId(r.jobId);
      toast.success(`Started job for ${r.total} unmatched ingest(s)`);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to start job");
    } finally {
      setStarting(false);
    }
  }



  async function onRetryFailed() {
    if (!current?.id) return;
    setRetrying(true);
    try {
      const r = await retryFn({
        data: {
          sourceJobId: current.id,
          days,
          categories: cats.size > 0 ? (Array.from(cats) as Cat[]) : undefined,
          dryRun,
        },
      });
      setJobId(r.jobId);
      toast.success(`Re-queued ${r.retried} failed entr${r.retried === 1 ? "y" : "ies"}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to re-queue");
    } finally {
      setRetrying(false);
    }
  }
  async function onDeleteJobs(ids: string[], label: string) {
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} job${ids.length === 1 ? "" : "s"} (${label})? This cannot be undone.`)) return;
    try {
      const r = await deleteFn({ data: { jobIds: ids } });
      toast.success(`Deleted ${r.deleted} job(s)${r.skipped ? ` · ${r.skipped} skipped (still running)` : ""}`);
      if (ids.includes(jobId ?? "")) setJobId(null);
      qc.invalidateQueries({ queryKey: ["bulk-job"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to delete");
    }
  }


  function onExportCsv() {
    if (!current) return;
    const header = ["ingestId", "decision", "parsedTitle", "category", "titleId", "titleName", "score", "error"];
    const rows = (results as any[]).map((r) => [
      r.ingestId ?? "",
      r.decision ?? "",
      r.parsedTitle ?? "",
      r.category ?? "",
      r.titleId ?? "",
      r.titleName ?? "",
      typeof r.score === "number" ? r.score.toFixed(4) : "",
      r.error ?? "",
    ]);
    const totals = [
      ["", "", "", "", "", "", "", ""],
      ["TOTALS", "", "", "", "", "", "", ""],
      ["processed", String(current.processed ?? 0), "", "", "", "", "", ""],
      ["promoted", String(current.promoted ?? 0), "", "", "", "", "", ""],
      ["failed", String(current.failed ?? 0), "", "", "", "", "", ""],
      ["still_unmatched", String(stillUnmatched), "", "", "", "", "", ""],
    ];
    const csv = [header, ...rows, ...totals]
      .map((line) =>
        line
          .map((cell) => {
            const s = String(cell ?? "");
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(","),
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bulk-rematch-${String(current.id).slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-6 max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Bulk rematch</h1>
        <p className="text-sm text-muted-foreground">
          Re-runs <code>forceRematchAndPublish</code> for every unmatched ingest in the window.
        </p>
      </header>

      <div className="rounded-xl border border-border p-4 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="days">Window (days)</Label>
            <Input
              id="days"
              type="number"
              min={1}
              max={180}
              value={days}
              onChange={(e) => setDays(Math.max(1, Math.min(180, Number(e.target.value) || 1)))}
              disabled={running || starting}
            />
          </div>
          <div className="flex items-end gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
                disabled={running || starting}
              />
              Dry run (no promotion)
            </label>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Media type filter <span className="text-xs text-muted-foreground">(empty = all)</span></Label>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <button
                type="button"
                key={c}
                onClick={() => toggleCat(c)}
                disabled={running || starting}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  cats.has(c)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border hover:bg-surface/60"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
        <Button onClick={onStart} disabled={running || starting}>
          {starting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Play className="h-4 w-4 mr-1.5" />}
          Start bulk rematch
        </Button>
      </div>

      {current && (
        <div className="rounded-xl border border-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Job {String(current.id).slice(0, 8)}</div>
              <div className="text-xs text-muted-foreground">
                Status: <span className="font-mono">{current.status}</span> · Started{" "}
                {new Date(current.started_at).toLocaleString()}
                {current.filters?.categories?.length
                  ? ` · cats: ${current.filters.categories.join(",")}`
                  : ""}
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={onRetryFailed}
                disabled={retrying || running || !(current.failed > 0)}
                title={current.failed > 0 ? "Re-queue only failed entries" : "No failed entries to retry"}
              >
                {retrying ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5 mr-1.5" />}
                Retry failed
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onExportCsv}
                disabled={results.length === 0}
              >
                <Download className="h-3.5 w-3.5 mr-1.5" /> Export CSV
              </Button>
              <Button variant="outline" size="sm" onClick={() => setJobId(null)}>
                View history
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onDeleteJobs([current.id], `job ${String(current.id).slice(0, 8)}`)}
                disabled={current.status === "running"}
                title={current.status === "running" ? "Wait for the job to finish" : "Delete this job"}
                className="text-red-500 hover:text-red-500"
              >
                <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete
              </Button>

            </div>
          </div>
          <Progress value={pct} />
          <div className="grid grid-cols-5 gap-3 text-sm">
            <Stat label="Processed" value={`${current.processed}/${current.total}`} />
            <Stat label="Rematched" value={current.promoted} tone="ok" />
            <Stat label="Still unmatched" value={stillUnmatched} tone="warn" />
            <Stat label="Failed" value={current.failed} tone="err" />
            <Stat label="%" value={`${pct}%`} />
          </div>
          {current.last_error && (
            <pre className="text-xs bg-muted p-2 rounded overflow-auto">{current.last_error}</pre>
          )}

          {results.length > 0 && (
            <div className="mt-2 border-t border-border pt-3">
              <h3 className="text-sm font-semibold mb-2">Per-title results ({results.length})</h3>
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="max-h-[420px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-surface/60 sticky top-0">
                      <tr className="text-left">
                        <th className="px-2 py-1.5">Status</th>
                        <th className="px-2 py-1.5">Parsed title</th>
                        <th className="px-2 py-1.5">Cat</th>
                        <th className="px-2 py-1.5">Matched to</th>
                        <th className="px-2 py-1.5 text-right">Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((r, i) => (
                        <tr key={r.ingestId + i} className="border-t border-border">
                          <td className="px-2 py-1.5">
                            <DecisionPill decision={r.decision} />
                          </td>
                          <td className="px-2 py-1.5 truncate max-w-[240px]">{r.parsedTitle ?? "(?)"}</td>
                          <td className="px-2 py-1.5 text-muted-foreground">{r.category ?? "—"}</td>
                          <td className="px-2 py-1.5 truncate max-w-[240px]">
                            {r.titleName ?? <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono">
                            {typeof r.score === "number" ? r.score.toFixed(3) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {!jobId && recent.length > 0 && (
        <div className="rounded-xl border border-border p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold">Recent jobs</h2>
            <Button
              variant="outline"
              size="sm"
              className="text-red-500 hover:text-red-500"
              onClick={() =>
                onDeleteJobs(
                  recent.filter((r: any) => r.status !== "running").map((r: any) => r.id),
                  "all finished jobs",
                )
              }
              disabled={recent.every((r: any) => r.status === "running")}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete all finished
            </Button>
          </div>
          <div className="space-y-2">
            {recent.map((r: any) => (
              <div
                key={r.id}
                className="w-full rounded-lg border border-border bg-surface/40 p-3 text-sm flex items-start gap-3 hover:bg-surface/70"
              >
                <button onClick={() => setJobId(r.id)} className="flex-1 text-left">
                  <div className="flex justify-between">
                    <span className="font-mono">{r.id.slice(0, 8)}</span>
                    <span className="text-xs text-muted-foreground">{r.status}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {r.processed}/{r.total} processed · {r.promoted} promoted · {r.failed} failed ·{" "}
                    {new Date(r.started_at).toLocaleString()}
                  </div>
                </button>
                <button
                  onClick={() => onDeleteJobs([r.id], `job ${r.id.slice(0, 8)}`)}
                  disabled={r.status === "running"}
                  className="text-muted-foreground hover:text-red-500 disabled:opacity-30 p-1"
                  aria-label="Delete job"
                  title={r.status === "running" ? "Wait for the job to finish" : "Delete this job"}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <ReparseSeriesPartsPanel />
      <ReparseCronSchedulePanel />
      <MessageDeletesPanel />
    </div>
  );
}

function MessageDeletesPanel() {
  const previewFn = useServerFn(previewMessageDeletes);
  const metricsFn = useServerFn(getDeleteCronMetrics);
  const [busy, setBusy] = useState(false);
  const [includeFuture, setIncludeFuture] = useState(false);
  const [limit, setLimit] = useState(50);
  const [result, setResult] = useState<any>(null);
  const metrics = useQuery({
    queryKey: ["delete-cron-metrics"],
    queryFn: () => metricsFn(),
    refetchInterval: 15000,
  });

  async function loadPreview() {
    setBusy(true);
    try {
      const r = await previewFn({ data: { limit, includeFuture } });
      setResult(r);
      toast.success(`Previewed ${r.count} deletion target${r.count === 1 ? "" : "s"}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to preview");
    } finally {
      setBusy(false);
    }
  }

  function download(format: "csv" | "json") {
    if (!result?.targets?.length) {
      toast.error("Run preview first");
      return;
    }
    let blob: Blob;
    if (format === "json") {
      blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    } else {
      const header = ["id", "chat_id", "message_id", "delete_at", "attempts", "overdue_seconds", "last_error"];
      const esc = (v: any) => {
        const s = String(v ?? "");
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const lines = [header.join(",")];
      for (const t of result.targets) {
        lines.push([t.id, t.chat_id, t.message_id, t.delete_at, t.attempts, t.overdue_seconds, t.last_error].map(esc).join(","));
      }
      blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `message-deletes-dryrun-${Date.now()}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const m: any = metrics.data;
  const summary: any = m?.last_summary ?? {};

  return (
    <div className="mt-6 rounded-xl border border-border bg-surface/40 p-4">
      <h2 className="text-base font-semibold mb-1">Private-chat auto-delete</h2>
      <p className="text-xs text-muted-foreground mb-3">
        Preview which scheduled deletions would run next and export the list for verification.
        Telemetry below comes from the most recent <code>process-message-deletes</code> cron run.
      </p>

      <div className="flex flex-wrap items-end gap-2 mb-3">
        <div className="space-y-1">
          <Label className="text-xs">Limit</Label>
          <Input
            type="number"
            min={1}
            max={500}
            value={limit}
            onChange={(e) => setLimit(Math.max(1, Math.min(500, Number(e.target.value) || 50)))}
            className="w-24"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={includeFuture} onChange={(e) => setIncludeFuture(e.target.checked)} />
          Include future
        </label>
        <Button size="sm" variant="outline" onClick={loadPreview} disabled={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Preview targets"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => download("csv")} disabled={!result?.count}>
          <Download className="h-3.5 w-3.5 mr-1.5" /> CSV
        </Button>
        <Button size="sm" variant="outline" onClick={() => download("json")} disabled={!result?.count}>
          <Download className="h-3.5 w-3.5 mr-1.5" /> JSON
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs mb-3">
        <Metric label="Last run" value={m?.last_run_at ? new Date(m.last_run_at).toLocaleString() : "—"} />
        <Metric label="Processed" value={summary.processed ?? 0} />
        <Metric label="Deleted" value={summary.deleted ?? 0} tone="ok" />
        <Metric label="Failed" value={summary.failed ?? 0} tone={summary.failed ? "err" : undefined} />
        <Metric label="429 rate-limited" value={summary.rate_limited_429 ?? 0} tone={summary.rate_limited_429 ? "warn" : undefined} />
        <Metric label="Retry-After total" value={`${summary.retry_after_ms_total ?? 0} ms`} />
        <Metric label="Retry attempts" value={summary.retry_attempts_total ?? 0} />
        <Metric label="Avg/msg" value={`${summary.avg_ms_per_message ?? 0} ms`} />
      </div>

      {result && (
        <pre className="max-h-64 overflow-auto rounded bg-background/60 p-2 text-[11px]">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}

function ReparseCronSchedulePanel() {
  const getCfg = useServerFn(getReparseCronConfig);
  const setCfg = useServerFn(setReparseCronConfig);
  const qc = useQueryClient();
  const cfg = useQuery({
    queryKey: ["reparse-cron-config"],
    queryFn: () => getCfg(),
  });
  const [enabled, setEnabled] = useState(false);
  const [limit, setLimit] = useState(500);
  const [dryRun, setDryRun] = useState(false);
  const [saving, setSaving] = useState(false);

  // hydrate when loaded
  const data: any = cfg.data;
  if (data && !cfg.isFetching && limit === 500 && enabled === false && !dryRun && data.limit !== 500) {
    // one-time hydrate
    setEnabled(!!data.enabled);
    setLimit(data.limit);
    setDryRun(!!data.dryRun);
  }

  async function save() {
    setSaving(true);
    try {
      await setCfg({ data: { enabled, limit, dryRun } });
      toast.success("Re-parse cron config saved");
      qc.invalidateQueries({ queryKey: ["reparse-cron-config"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const status: any = data?.status;
  const summary: any = status?.last_summary ?? {};

  return (
    <div className="mt-6 rounded-xl border border-border bg-surface/40 p-4">
      <h2 className="text-base font-semibold mb-1">Re-parse cron schedule</h2>
      <p className="text-xs text-muted-foreground mb-3">
        Runs the SxxPnEyy backfill periodically for newly ingested or re-cropped TV series files.
        The schedule itself is managed by <code>pg_cron</code>; this toggle enables/disables work per run.
      </p>
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enabled
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
          Dry-run only
        </label>
        <div className="space-y-1">
          <Label className="text-xs">Rows per run</Label>
          <Input
            type="number"
            min={1}
            max={2000}
            value={limit}
            onChange={(e) => setLimit(Math.max(1, Math.min(2000, Number(e.target.value) || 500)))}
            className="w-28"
          />
        </div>
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
        </Button>
      </div>
      {status && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <Metric label="Last run" value={status.last_run_at ? new Date(status.last_run_at).toLocaleString() : "—"} />
          <Metric label="Scanned" value={summary.scanned ?? 0} />
          <Metric label="Changed" value={summary.changed ?? 0} tone={summary.changed ? "warn" : undefined} />
          <Metric label="Updated" value={summary.updated_ingest ?? 0} tone="ok" />
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "ok" | "warn" | "err" }) {
  const color =
    tone === "ok" ? "text-emerald-500" : tone === "warn" ? "text-amber-500" : tone === "err" ? "text-red-500" : "";
  return (
    <div className="rounded-lg border border-border bg-background/40 p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-sm font-mono ${color}`}>{value}</div>
    </div>
  );
}

function ReparseDryRunFooter() {
  return null;
}

// Spacer keeps original component layout below intact.
function _layoutSpacer() {
  return (
    <></>
  );
    </div>
  );
}

function ReparseSeriesPartsPanel() {
  const fn = useServerFn(reparseSeriesParts);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof fn>> | null>(null);

  async function run(dry: boolean) {
    setBusy(true);
    try {
      const r = await fn({ data: { dryRun: dry, limit: 500, offset: 0 } });
      setResult(r);
      toast.success(
        dry
          ? `Dry-run: ${r.changed_count} of ${r.scanned} rows would be re-parsed`
          : `Re-parsed ${r.updated_ingest} ingest rows, relinked ${r.relinked_files} files`,
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-border bg-surface/40 p-4">
      <h2 className="text-base font-semibold mb-1">Re-parse TV series Part/Episode metadata</h2>
      <p className="text-xs text-muted-foreground mb-3">
        Scans already-ingested rows and updates any whose caption/filename uses the
        <code className="mx-1 rounded bg-muted px-1">SxxPnEyy</code> pattern so the
        season/part/episode encoding matches the current parser.
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => run(true)} disabled={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Dry-run"}
        </Button>
        <Button size="sm" onClick={() => run(false)} disabled={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Re-parse now"}
        </Button>
      </div>
      {result && (
        <pre className="mt-3 max-h-64 overflow-auto rounded bg-background/60 p-2 text-[11px]">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}


function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "ok" | "warn" | "err";
}) {
  const color =
    tone === "ok"
      ? "text-emerald-500"
      : tone === "warn"
        ? "text-amber-500"
        : tone === "err"
          ? "text-red-500"
          : "";
  return (
    <div className="rounded-lg border border-border bg-surface/40 p-2 text-center">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-base font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function DecisionPill({ decision }: { decision: string }) {
  if (decision === "promoted")
    return (
      <span className="inline-flex items-center gap-1 text-emerald-500">
        <CheckCircle2 className="h-3 w-3" /> rematched
      </span>
    );
  if (decision === "failed")
    return (
      <span className="inline-flex items-center gap-1 text-red-500">
        <XCircle className="h-3 w-3" /> failed
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-amber-500">
      <AlertCircle className="h-3 w-3" /> unmatched
    </span>
  );
}
