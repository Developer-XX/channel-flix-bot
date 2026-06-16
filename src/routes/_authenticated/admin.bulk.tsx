import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Loader2, Play } from "lucide-react";
import { startBulkRematch, getBulkJobStatus } from "@/lib/bulk.functions";

export const Route = createFileRoute("/_authenticated/admin/bulk")({
  component: BulkRematchPage,
});

function BulkRematchPage() {
  const startFn = useServerFn(startBulkRematch);
  const statusFn = useServerFn(getBulkJobStatus);
  const [days, setDays] = useState(7);
  const [dryRun, setDryRun] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

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

  async function onStart() {
    setStarting(true);
    try {
      const r = await startFn({ data: { days, dryRun } });
      setJobId(r.jobId);
      toast.success(`Started job for ${r.total} unmatched ingest(s)`);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to start job");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="p-6 max-w-3xl space-y-6">
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
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => setJobId(null)}>
              View history
            </Button>
          </div>
          <Progress value={pct} />
          <div className="grid grid-cols-4 gap-3 text-sm">
            <Stat label="Processed" value={`${current.processed}/${current.total}`} />
            <Stat label="Promoted" value={current.promoted} />
            <Stat label="Failed" value={current.failed} />
            <Stat label="%" value={`${pct}%`} />
          </div>
          {current.last_error && (
            <pre className="text-xs bg-muted p-2 rounded overflow-auto">{current.last_error}</pre>
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

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface/40 p-2 text-center">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-base font-semibold">{value}</div>
    </div>
  );
}
