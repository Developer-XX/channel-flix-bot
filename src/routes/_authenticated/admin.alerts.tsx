import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { RefreshCw, AlertTriangle, CheckCircle2, Clock, ShieldCheck, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { listAdminAlerts, ackAdminAlert } from "@/lib/admin-alerts.functions";

export const Route = createFileRoute("/_authenticated/admin/alerts")({
  component: AdminAlertsPage,
});

function fmtAge(sec: number | null): string {
  if (sec == null) return "never";
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function AdminAlertsPage() {
  const fn = useServerFn(listAdminAlerts);
  const ack = useServerFn(ackAdminAlert);
  const q = useQuery({ queryKey: ["admin-alerts"], queryFn: () => fn(), refetchInterval: 15_000 });

  const onAck = async (id: string, resolve: boolean) => {
    try {
      await ack({ data: { id, resolve } } as never);
      toast.success(resolve ? "Resolved" : "Acknowledged");
      await q.refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <AlertTriangle className="h-6 w-6" /> Alerts & cron health
        </h1>
        <Button variant="outline" size="sm" onClick={() => q.refetch()}>
          <RefreshCw className={`h-4 w-4 mr-1 ${q.isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <section>
        <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <Activity className="h-4 w-4" /> Cron jobs
        </h2>
        <div className="rounded-md border border-border divide-y divide-border">
          {q.data?.cron.length === 0 && <div className="p-3 text-sm text-muted-foreground">No registered cron jobs yet.</div>}
          {q.data?.cron.map((c: any) => (
            <div key={c.job_name} className="p-3 text-sm flex flex-wrap items-center gap-3">
              <div className="font-mono">{c.job_name}</div>
              <div className={`text-xs px-2 py-0.5 rounded-full ${c.consecutive_failures > 0 ? "bg-destructive/15 text-destructive" : "bg-emerald-500/15 text-emerald-500"}`}>
                {c.consecutive_failures > 0 ? `${c.consecutive_failures} failing` : "ok"}
              </div>
              <div className={`text-xs ${c.isLagging ? "text-amber-500" : "text-muted-foreground"}`}>
                Last run: {fmtAge(c.ageSec)}{c.isLagging && " (lagging)"}
              </div>
              <div className="text-xs text-muted-foreground">
                {c.total_runs ?? 0} runs · {c.total_failures ?? 0} failed
              </div>
              {c.last_error && (
                <div className="basis-full text-xs text-destructive break-all">Last error: {c.last_error}</div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" /> Open alerts
        </h2>
        <div className="rounded-md border border-border divide-y divide-border">
          {q.data?.open.length === 0 && (
            <div className="p-3 text-sm text-muted-foreground flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" /> No open alerts.
            </div>
          )}
          {q.data?.open.map((a: any) => (
            <div key={a.id} className="p-3 text-sm space-y-2">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className={`text-xs px-1.5 py-0.5 rounded uppercase ${a.severity === "error" ? "bg-destructive/15 text-destructive" : a.severity === "warn" ? "bg-amber-500/15 text-amber-500" : "bg-muted"}`}>
                  {a.severity}
                </span>
                <span className="font-mono text-xs">{a.kind}</span>
                <span className="text-xs text-muted-foreground">×{a.occurrences}</span>
                {a.acknowledged_at && <span className="text-xs text-muted-foreground flex items-center gap-1"><ShieldCheck className="h-3 w-3" /> acked</span>}
              </div>
              <div className="text-sm">{a.subject}</div>
              <pre className="text-[11px] bg-muted/40 p-2 rounded overflow-x-auto">{JSON.stringify(a.details, null, 2)}</pre>
              <div className="flex gap-2">
                {!a.acknowledged_at && (
                  <Button size="sm" variant="outline" onClick={() => onAck(a.id, false)}>Acknowledge</Button>
                )}
                <Button size="sm" onClick={() => onAck(a.id, true)}>Resolve</Button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {q.data && q.data.recent.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <Clock className="h-4 w-4" /> Recently resolved
          </h2>
          <div className="rounded-md border border-border divide-y divide-border text-xs">
            {q.data.recent.map((a: any) => (
              <div key={a.id} className="p-2 flex flex-wrap gap-2 items-baseline">
                <span className="font-mono">{a.kind}</span>
                <span className="truncate flex-1">{a.subject}</span>
                <span className="text-muted-foreground">{new Date(a.resolved_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
