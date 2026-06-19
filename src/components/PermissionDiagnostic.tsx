import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  getTablePermissionDiagnostic,
  runTelegramIngestGrantsCheck,
  type TableDiagnostic,
} from "@/lib/permission-diagnostics.functions";

export function IngestErrorBanner({
  error,
  onRetry,
}: {
  error: Error;
  onRetry: () => void;
}) {
  const msg = error?.message ?? String(error);
  const isPermDenied = /PERMISSION_DENIED:telegram_ingest|permission denied for table .*telegram_ingest/i.test(msg);
  const [showDiag, setShowDiag] = useState(false);

  if (!isPermDenied) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
        <div className="flex items-center justify-between gap-3">
          <span className="break-all">{msg}</span>
          <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="font-semibold text-destructive">Permission denied loading Telegram files</p>
          <p className="text-sm text-muted-foreground">
            Your account is authenticated, but the database has revoked grants on{" "}
            <code className="rounded bg-muted px-1">telegram_ingest</code>. This usually
            happens after a security migration. Open the diagnostic below to see exactly
            which grant or RLS policy is blocking access, then re-run the nightly drift
            check to confirm.
          </p>
        </div>
        <div className="flex flex-col gap-2 shrink-0">
          <Button size="sm" onClick={onRetry}>Retry</Button>
          <Button size="sm" variant="outline" onClick={() => setShowDiag((v) => !v)}>
            {showDiag ? "Hide" : "Show"} diagnostic
          </Button>
        </div>
      </div>
      {showDiag && <PermissionDiagnostic table="telegram_ingest" onRetry={onRetry} />}
    </div>
  );
}

export function PermissionDiagnostic({
  table,
  onRetry,
}: {
  table: string;
  onRetry?: () => void;
}) {
  const diagnose = useServerFn(getTablePermissionDiagnostic);
  const driftCheck = useServerFn(runTelegramIngestGrantsCheck);
  const [running, setRunning] = useState(false);

  const q = useQuery<TableDiagnostic>({
    queryKey: ["perm-diag", table],
    queryFn: () => diagnose({ data: { table } }),
  });

  const grantsByRole = new Map<string, string[]>();
  for (const g of q.data?.table_grants ?? []) {
    const arr = grantsByRole.get(g.grantee) ?? [];
    arr.push(g.privilege);
    grantsByRole.set(g.grantee, arr);
  }
  const expected: Array<[string, string[]]> = [
    ["authenticated", ["SELECT", "INSERT", "UPDATE", "DELETE"]],
    ["service_role", ["SELECT", "INSERT", "UPDATE", "DELETE"]],
  ];

  return (
    <div className="rounded-md border bg-card p-3 space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <div className="font-medium">Permission diagnostic · <code>{table}</code></div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => q.refetch()}>Refresh</Button>
          {table === "telegram_ingest" && (
            <Button
              size="sm"
              variant="outline"
              disabled={running}
              onClick={async () => {
                setRunning(true);
                try {
                  const r = await driftCheck();
                  if (r.drift) toast.error(`Drift detected · missing ${r.missing.length} grant(s)`);
                  else toast.success("No drift · grants match expected baseline");
                  await q.refetch();
                  onRetry?.();
                } catch (e) {
                  toast.error((e as Error).message);
                } finally {
                  setRunning(false);
                }
              }}
            >
              Run drift check
            </Button>
          )}
        </div>
      </div>

      {q.isLoading && <p className="text-muted-foreground">Inspecting grants…</p>}
      {q.error && <p className="text-destructive">{(q.error as Error).message}</p>}

      {q.data && (
        <>
          <div>
            <div className="text-xs font-medium uppercase text-muted-foreground mb-1">RLS</div>
            <Badge variant={q.data.rls_enabled ? "default" : "destructive"}>
              {q.data.rls_enabled ? "Row-Level Security enabled" : "RLS DISABLED"}
            </Badge>
          </div>

          <div>
            <div className="text-xs font-medium uppercase text-muted-foreground mb-1">
              Table grants vs expected
            </div>
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr><th className="py-1">Role</th><th>Expected</th><th>Actual</th><th>Status</th></tr>
              </thead>
              <tbody>
                {expected.map(([role, want]) => {
                  const have = grantsByRole.get(role) ?? [];
                  const missing = want.filter((p) => !have.includes(p));
                  return (
                    <tr key={role} className="border-t">
                      <td className="py-1 font-mono">{role}</td>
                      <td className="py-1">{want.join(", ")}</td>
                      <td className="py-1">{have.length ? have.join(", ") : <span className="text-destructive">none</span>}</td>
                      <td className="py-1">
                        {missing.length === 0 ? (
                          <Badge variant="secondary">OK</Badge>
                        ) : (
                          <Badge variant="destructive">missing: {missing.join(", ")}</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {[...grantsByRole.keys()]
                  .filter((r) => !expected.some(([e]) => e === r))
                  .map((role) => (
                    <tr key={role} className="border-t">
                      <td className="py-1 font-mono">{role}</td>
                      <td className="py-1 text-muted-foreground">—</td>
                      <td className="py-1">{(grantsByRole.get(role) ?? []).join(", ")}</td>
                      <td className="py-1"><Badge variant="outline">extra</Badge></td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <div>
            <div className="text-xs font-medium uppercase text-muted-foreground mb-1">
              RLS policies ({q.data.policies.length})
            </div>
            {q.data.policies.length === 0 ? (
              <p className="text-muted-foreground">No policies defined.</p>
            ) : (
              <div className="space-y-1">
                {q.data.policies.map((p) => (
                  <details key={p.name} className="rounded border p-2">
                    <summary className="cursor-pointer">
                      <span className="font-mono">{p.name}</span>{" "}
                      <Badge variant="outline" className="ml-1">{p.cmd}</Badge>{" "}
                      <span className="text-xs text-muted-foreground">
                        to {Array.isArray(p.roles) ? p.roles.join(", ") : String(p.roles)}
                      </span>
                    </summary>
                    <pre className="mt-2 overflow-x-auto text-xs">
{`USING: ${p.using ?? "—"}
CHECK: ${p.check ?? "—"}`}
                    </pre>
                  </details>
                ))}
              </div>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Checked {new Date(q.data.checked_at).toLocaleString()}
          </p>
        </>
      )}
    </div>
  );
}
