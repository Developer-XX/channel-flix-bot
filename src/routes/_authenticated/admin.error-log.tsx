import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { listAdminErrors } from "@/lib/admin-health.functions";

export const Route = createFileRoute("/_authenticated/admin/error-log")({
  component: AdminErrorLogPage,
});

function AdminErrorLogPage() {
  const fn = useServerFn(listAdminErrors);
  const q = useQuery({
    queryKey: ["admin-error-log"],
    queryFn: () => fn({ data: { limit: 100 } }),
    refetchInterval: 60_000,
    retry: 0,
  });

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Server-function error log</h1>
          <p className="text-sm text-muted-foreground">
            Latest 100 server-function failures. Auto-refreshes every minute.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${q.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {q.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {q.error && (
        <pre className="text-xs bg-destructive/10 text-destructive p-3 rounded">
          {(q.error as Error).message}
        </pre>
      )}

      {q.data && q.data.rows.length === 0 && (
        <div className="rounded-md border border-border p-6 text-center text-sm text-muted-foreground">
          No errors logged. 🎉
        </div>
      )}

      {q.data && q.data.rows.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left">When</th>
                <th className="px-3 py-2 text-left">Function</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Duration</th>
                <th className="px-3 py-2 text-left">Message</th>
                <th className="px-3 py-2 text-left">Request ID</th>
              </tr>
            </thead>
            <tbody>
              {q.data.rows.map((r) => (
                <tr key={r.id} className="border-t border-border align-top">
                  <td className="px-3 py-2 whitespace-nowrap">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 font-mono break-all max-w-[200px]">
                    {r.fn_export ?? "-"}
                  </td>
                  <td className="px-3 py-2">{r.status ?? "-"}</td>
                  <td className="px-3 py-2">{r.duration_ms ?? "-"}ms</td>
                  <td className="px-3 py-2 max-w-[400px] break-words">
                    {r.error_message ?? "-"}
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">
                    {r.request_id}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
