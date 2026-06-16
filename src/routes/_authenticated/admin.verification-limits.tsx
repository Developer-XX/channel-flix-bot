import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listVerificationRateLimits } from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/admin/verification-limits")({
  component: VerificationLimitsPage,
});

function VerificationLimitsPage() {
  const fn = useServerFn(listVerificationRateLimits);
  const q = useQuery({ queryKey: ["admin-verif-limits"], queryFn: () => fn() });

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Verification rate-limit log</h1>
          <p className="text-sm text-muted-foreground">
            Every time a user hits the verification cap, we record it here with the file context that triggered it.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => q.refetch()}>Refresh</Button>
      </div>

      {q.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {q.error && <p className="text-sm text-destructive">{(q.error as Error).message}</p>}
      {q.data?.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No rate-limit rejections recorded.
        </div>
      )}
      {q.data && q.data.length > 0 && (
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface/60 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left p-2">When</th>
                  <th className="text-left p-2">User</th>
                  <th className="text-left p-2">Media file</th>
                  <th className="text-left p-2">Used / cap</th>
                  <th className="text-left p-2">Retry in</th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((r) => {
                  const retryMin = r.parsed?.retryAfterMs
                    ? Math.ceil(r.parsed.retryAfterMs / 60000)
                    : null;
                  return (
                    <tr key={r.id} className="border-t border-border/60">
                      <td className="p-2 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                      <td className="p-2 font-mono text-xs break-all max-w-[200px]">{r.user_id ?? "—"}</td>
                      <td className="p-2 font-mono text-xs break-all max-w-[260px]">
                        {r.parsed?.mediaFileId ?? <span className="text-muted-foreground">(no file)</span>}
                      </td>
                      <td className="p-2">
                        <Badge variant="secondary">
                          {r.parsed?.used ?? "?"} / {r.parsed?.capacity ?? "?"}
                        </Badge>
                      </td>
                      <td className="p-2">{retryMin != null ? `${retryMin} min` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
