import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw, Filter, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getAdminAuditLog } from "@/lib/download-history.functions";

export const Route = createFileRoute("/_authenticated/admin/audit")({
  component: AdminAuditPage,
});

function AdminAuditPage() {
  const fn = useServerFn(getAdminAuditLog);
  const [filter, setFilter] = useState<{ action?: string; search?: string; sinceMs?: number; offset: number; limit: number }>(
    { offset: 0, limit: 50 },
  );
  const [expanded, setExpanded] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["admin-audit", filter],
    queryFn: () => fn({ data: filter } as never),
    refetchInterval: 30_000,
  });

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Audit log</h1>
        <Button variant="outline" size="sm" onClick={() => q.refetch()}>
          <RefreshCw className={`h-4 w-4 mr-1 ${q.isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <div className="rounded-md border border-border p-3 flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-2 text-sm">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <select
            className="bg-background border border-border rounded px-2 py-1 text-sm"
            value={filter.action ?? ""}
            onChange={(e) => setFilter((f) => ({ ...f, action: e.target.value || undefined, offset: 0 }))}
          >
            <option value="">All actions</option>
            {q.data?.actions.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        <Input
          placeholder="Search action…"
          className="max-w-xs"
          value={filter.search ?? ""}
          onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value || undefined, offset: 0 }))}
        />
        <select
          className="bg-background border border-border rounded px-2 py-1 text-sm"
          value={filter.sinceMs ?? ""}
          onChange={(e) => setFilter((f) => ({ ...f, sinceMs: e.target.value ? Number(e.target.value) : undefined, offset: 0 }))}
        >
          <option value="">All time</option>
          <option value={3600_000}>Last hour</option>
          <option value={86400_000}>Last 24h</option>
          <option value={7 * 86400_000}>Last 7 days</option>
        </select>
        <div className="ml-auto text-xs text-muted-foreground">
          {q.data?.total ?? 0} events
        </div>
      </div>

      {q.error && <div className="text-destructive text-sm">{(q.error as Error).message}</div>}

      <div className="rounded-md border border-border divide-y divide-border">
        {q.data?.rows.map((r) => (
          <div key={r.id} className="p-3 text-sm">
            <button
              type="button"
              className="w-full text-left flex flex-wrap items-baseline gap-x-3 gap-y-1"
              onClick={() => setExpanded((e) => (e === r.id ? null : r.id))}
            >
              <span className={`font-mono text-xs px-1.5 py-0.5 rounded ${r.status === "failed" ? "bg-destructive/15 text-destructive" : "bg-muted"}`}>
                {r.action}
              </span>
              <span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</span>
              {r.actor_email && <span className="text-xs">{r.actor_email}</span>}
              {r.status && r.status !== "success" && (
                <span className="text-xs text-amber-500 uppercase">{r.status}</span>
              )}
            </button>
            {expanded === r.id && (
              <pre className="mt-2 text-[11px] bg-muted/40 p-2 rounded overflow-x-auto">
                {JSON.stringify(r.metadata, null, 2)}
              </pre>
            )}
          </div>
        ))}
        {q.data?.rows.length === 0 && (
          <div className="p-6 text-center text-sm text-muted-foreground">No matching events</div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          disabled={filter.offset === 0}
          onClick={() => setFilter((f) => ({ ...f, offset: Math.max(0, f.offset - f.limit) }))}
        >
          <ChevronLeft className="h-4 w-4" /> Prev
        </Button>
        <span className="text-xs text-muted-foreground">
          {filter.offset + 1}–{Math.min(filter.offset + filter.limit, q.data?.total ?? 0)} of {q.data?.total ?? 0}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={(filter.offset + filter.limit) >= (q.data?.total ?? 0)}
          onClick={() => setFilter((f) => ({ ...f, offset: f.offset + f.limit }))}
        >
          Next <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
