import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, AlertTriangle, XCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { runAuthDiagnostics, listAccessAudit } from "@/lib/diagnostics.functions";

export const Route = createFileRoute("/_authenticated/admin/diagnostics")({
  component: DiagnosticsPage,
});

const RLS_CODES: { code: string; meaning: string }[] = [
  { code: "RLS_PERMISSION_DENIED", meaning: "GRANT missing OR every USING policy returned false. Check both." },
  { code: "RLS_ROW_HIDDEN", meaning: "USING clause evaluated false for this row (token role lacks visibility)." },
  { code: "RLS_POLICY_RECURSION", meaning: "Policy referenced its own table — refactor to a SECURITY DEFINER helper." },
  { code: "JWT_EXPIRED", meaning: "Bearer token expired before reaching PostgREST." },
  { code: "JWT_INVALID", meaning: "Token signature/format invalid." },
  { code: "API_KEY_NOT_JWT", meaning: "Server used sb_secret_* on Data API path expecting JWT key." },
];

function DiagnosticsPage() {
  const run = useServerFn(runAuthDiagnostics);
  const audit = useServerFn(listAccessAudit);
  const q = useQuery({ queryKey: ["auth-diagnostics"], queryFn: () => run(), retry: false });
  const auditQ = useQuery({ queryKey: ["access-audit"], queryFn: () => audit({ data: { limit: 50 } }), retry: false });

  return (
    <div className="p-3 sm:p-6 max-w-4xl mx-auto space-y-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-2xl font-bold truncate">Auth & Admin Diagnostics</h1>
          <p className="text-xs text-muted-foreground">Precise reasons why /admin may or may not load.</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => { q.refetch(); auditQ.refetch(); }} disabled={q.isFetching}>
          <RefreshCw className={`h-3.5 w-3.5 sm:mr-1.5 ${q.isFetching ? "animate-spin" : ""}`} />
          <span className="hidden sm:inline">Re-run</span>
        </Button>
      </div>

      {q.isLoading && <div className="text-sm text-muted-foreground">Running checks…</div>}
      {q.error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <div className="font-medium">Diagnostics failed</div>
          <div className="font-mono text-xs mt-1 break-words">{(q.error as Error).message}</div>
        </div>
      )}

      {q.data && (
        <>
          <div className="rounded-md border border-border p-3 text-xs space-y-0.5">
            <div className="break-all"><span className="text-muted-foreground">User id:</span> <span className="font-mono">{q.data.userId}</span></div>
            <div className="break-all"><span className="text-muted-foreground">Email:</span> {q.data.email ?? "(none)"}</div>
          </div>
          <div className="space-y-2">
            {q.data.checks.map((c) => (
              <div key={c.code} className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 items-start rounded-md border border-border p-3">
                <StatusIcon status={c.status} />
                <div className="min-w-0">
                  <div className="flex flex-wrap gap-2 items-center">
                    <span className="font-mono text-xs font-semibold break-all">{c.code}</span>
                    <span className={`text-[10px] uppercase tracking-wide ${badgeClass(c.status)}`}>{c.status}</span>
                  </div>
                  <div className="text-sm mt-0.5 break-words">{c.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <section className="rounded-md border border-border p-3 space-y-2">
        <h2 className="font-semibold text-sm">RLS / JWT error code reference</h2>
        <ul className="text-xs space-y-1">
          {RLS_CODES.map((r) => (
            <li key={r.code} className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
              <code className="font-mono text-[11px] text-amber-600 dark:text-amber-300 whitespace-nowrap">{r.code}</code>
              <span className="text-muted-foreground">{r.meaning}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-md border border-border p-3 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm">Recent access audit log</h2>
          <span className="text-[10px] text-muted-foreground">{auditQ.data?.length ?? 0} rows</span>
        </div>
        {auditQ.error && (
          <p className="text-xs text-destructive break-words">{(auditQ.error as Error).message}</p>
        )}
        <div className="overflow-x-auto -mx-3 sm:mx-0">
          <table className="w-full text-[11px] min-w-[640px]">
            <thead className="text-muted-foreground">
              <tr className="text-left">
                <th className="p-1.5">Time</th>
                <th className="p-1.5">Event</th>
                <th className="p-1.5">Code</th>
                <th className="p-1.5">Status</th>
                <th className="p-1.5">JWT exp</th>
                <th className="p-1.5">Admin</th>
                <th className="p-1.5">Detail</th>
              </tr>
            </thead>
            <tbody>
              {(auditQ.data ?? []).map((r: any) => (
                <tr key={r.id} className="border-t border-border/50 align-top">
                  <td className="p-1.5 whitespace-nowrap text-muted-foreground">{new Date(r.created_at).toLocaleTimeString()}</td>
                  <td className="p-1.5">{r.event}</td>
                  <td className="p-1.5 font-mono">{r.code}</td>
                  <td className={`p-1.5 ${badgeClass(r.status)}`}>{r.status}</td>
                  <td className="p-1.5 text-muted-foreground">{r.jwt_exp_in ?? "—"}s</td>
                  <td className="p-1.5">{r.has_admin_role === null ? "?" : r.has_admin_role ? "yes" : "no"}</td>
                  <td className="p-1.5 text-muted-foreground break-words max-w-[260px]">{r.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="pt-2"><Link to="/admin" className="text-sm text-primary">← Back to admin</Link></div>
    </div>
  );
}

function StatusIcon({ status }: { status: "ok" | "warn" | "fail" }) {
  if (status === "ok") return <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />;
  if (status === "warn") return <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />;
  return <XCircle className="h-5 w-5 text-red-500 shrink-0" />;
}

function badgeClass(status: "ok" | "warn" | "fail" | string): string {
  if (status === "ok") return "text-emerald-500";
  if (status === "warn") return "text-amber-500";
  return "text-red-500";
}
