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
          <h2 className="font-semibold mb-2">Recent jobs</h2>
          <div className="space-y-2">
            {recent.map((r: any) => (
              <button
                key={r.id}
                onClick={() => setJobId(r.id)}
                className="w-full text-left rounded-lg border border-border bg-surface/40 p-3 hover:bg-surface/70 text-sm"
              >
                <div className="flex justify-between">
                  <span className="font-mono">{r.id.slice(0, 8)}</span>
                  <span className="text-xs text-muted-foreground">{r.status}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {r.processed}/{r.total} processed · {r.promoted} promoted · {r.failed} failed ·{" "}
                  {new Date(r.started_at).toLocaleString()}
                </div>
              </button>
            ))}
          </div>
        </div>
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
