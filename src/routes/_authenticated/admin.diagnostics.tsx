import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, AlertTriangle, XCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { runAuthDiagnostics } from "@/lib/diagnostics.functions";

export const Route = createFileRoute("/_authenticated/admin/diagnostics")({
  component: DiagnosticsPage,
});

function DiagnosticsPage() {
  const run = useServerFn(runAuthDiagnostics);
  const q = useQuery({
    queryKey: ["auth-diagnostics"],
    queryFn: () => run(),
    retry: false,
  });

  return (
    <div className="p-4 sm:p-6 max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Auth & Admin Diagnostics</h1>
          <p className="text-xs text-muted-foreground">
            Precise reasons why /admin may or may not load. Each check returns an error code.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => q.refetch()} disabled={q.isFetching}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${q.isFetching ? "animate-spin" : ""}`} />
          Re-run
        </Button>
      </div>

      {q.isLoading && <div className="text-sm text-muted-foreground">Running checks…</div>}
      {q.error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <div className="font-medium">Diagnostics failed</div>
          <div className="font-mono text-xs mt-1">{(q.error as Error).message}</div>
        </div>
      )}

      {q.data && (
        <>
          <div className="rounded-md border border-border p-3 text-xs space-y-0.5">
            <div><span className="text-muted-foreground">User id:</span> <span className="font-mono">{q.data.userId}</span></div>
            <div><span className="text-muted-foreground">Email:</span> {q.data.email ?? "(none)"}</div>
          </div>
          <div className="space-y-2">
            {q.data.checks.map((c) => (
              <div
                key={c.code}
                className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 items-start rounded-md border border-border p-3"
              >
                <StatusIcon status={c.status} />
                <div className="min-w-0">
                  <div className="flex flex-wrap gap-2 items-center">
                    <span className="font-mono text-xs font-semibold">{c.code}</span>
                    <span className={`text-[10px] uppercase tracking-wide ${badgeClass(c.status)}`}>
                      {c.status}
                    </span>
                  </div>
                  <div className="text-sm mt-0.5 break-words">{c.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="pt-2">
        <Link to="/admin" className="text-sm text-primary">← Back to admin</Link>
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: "ok" | "warn" | "fail" }) {
  if (status === "ok") return <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />;
  if (status === "warn") return <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />;
  return <XCircle className="h-5 w-5 text-red-500 shrink-0" />;
}

function badgeClass(status: "ok" | "warn" | "fail"): string {
  if (status === "ok") return "text-emerald-500";
  if (status === "warn") return "text-amber-500";
  return "text-red-500";
}
