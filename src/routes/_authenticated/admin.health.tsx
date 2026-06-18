import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, XCircle, AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAdminHealth } from "@/lib/admin-health.functions";

export const Route = createFileRoute("/_authenticated/admin/health")({
  component: AdminHealthPage,
});

function AdminHealthPage() {
  const fn = useServerFn(getAdminHealth);
  const q = useQuery({
    queryKey: ["admin-health"],
    queryFn: () => fn(),
    refetchInterval: 30_000,
    retry: 0,
  });

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Admin Health Check</h1>
          <p className="text-sm text-muted-foreground">
            Live status of the backend, registered server functions, and required secrets.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${q.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {q.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}

      {q.error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4">
          <div className="flex items-center gap-2 font-medium text-destructive">
            <XCircle className="h-5 w-5" />
            Health check failed
          </div>
          <pre className="mt-2 text-xs whitespace-pre-wrap">{(q.error as Error).message}</pre>
          <p className="text-xs text-muted-foreground mt-2">
            This usually means a critical server function (getAdminHealth) is not registered — the
            client may be running a stale bundle. Try a hard reload.
          </p>
        </div>
      )}

      {q.data && (
        <>
          <Section title="Overall">
            <Row label="Status" value={q.data.ok ? "Healthy" : "Degraded"} ok={q.data.ok} />
            <Row label="Build ID" value={q.data.buildId} mono />
            <Row label="Worker uptime" value={`${q.data.runtime.uptimeSec ?? "n/a"}s`} />
            <Row label="Last checked" value={new Date(q.data.timestamp).toLocaleTimeString()} />
          </Section>

          <Section title="Database">
            <Row label="Connection" value={q.data.database.ok ? "OK" : "Failed"} ok={q.data.database.ok} />
            {q.data.database.error && <Row label="Error" value={q.data.database.error} mono />}
          </Section>

          <Section title="Server-function errors">
            <Row label="Last 1 hour" value={String(q.data.errorCounts.last1h)} ok={q.data.errorCounts.last1h === 0} />
            <Row label="Last 24 hours" value={String(q.data.errorCounts.last24h)} ok={q.data.errorCounts.last24h === 0} />
            <div className="pt-2">
              <Link to="/admin/error-log" className="text-sm text-primary hover:underline">
                View error log →
              </Link>
            </div>
          </Section>

          <Section title="Required secrets">
            {q.data.secrets.map((s) => (
              <Row key={s.name} label={s.name} value={s.present ? "Present" : "Missing"} ok={s.present} />
            ))}
          </Section>
        </>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-1">
      <h2 className="font-semibold mb-2">{title}</h2>
      {children}
    </div>
  );
}

function Row({
  label,
  value,
  ok,
  mono,
}: {
  label: string;
  value: string;
  ok?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`flex items-center gap-1.5 ${mono ? "font-mono text-xs" : ""}`}>
        {ok === true && <CheckCircle2 className="h-4 w-4 text-green-500" />}
        {ok === false && <AlertCircle className="h-4 w-4 text-amber-500" />}
        <span className="break-all text-right">{value}</span>
      </span>
    </div>
  );
}
