import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Download, RefreshCw } from "lucide-react";
import { getSyncTrace } from "@/lib/diagnostics.functions";

export const Route = createFileRoute("/_authenticated/admin/sync-trace")({
  component: SyncTracePage,
});

function SyncTracePage() {
  const fn = useServerFn(getSyncTrace);
  const [titleId, setTitleId] = useState("");
  const [runId, setRunId] = useState("");

  const q = useQuery({
    queryKey: ["sync-trace", titleId, runId],
    queryFn: () => fn({ data: { titleId: titleId || undefined, runId: runId || undefined, limit: 500 } }),
    retry: false,
  });

  function exportCsv() {
    const rows = q.data ?? [];
    if (!rows.length) return;
    const cols = [
      "created_at", "run_id", "source", "title_id", "title_slug", "channel_id",
      "message_id", "ingest_id", "season_number", "episode_number", "decision", "reason_code", "details",
    ];
    const esc = (v: unknown) => {
      if (v == null) return "";
      const s = typeof v === "object" ? JSON.stringify(v) : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [cols.join(",")];
    for (const r of rows as Array<Record<string, unknown>>) {
      lines.push(cols.map((c) => esc(r[c])).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sync-trace-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-full">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">Sync Trace</h1>
        <p className="text-xs text-muted-foreground">
          Per-message decisions from the Telegram sync pipeline. Use this to trace why an episode was or wasn't promoted.
        </p>
      </div>

      <div className="grid sm:grid-cols-[1fr_1fr_auto_auto] gap-2 items-end">
        <div>
          <label className="text-xs text-muted-foreground">Title id</label>
          <Input value={titleId} onChange={(e) => setTitleId(e.target.value)} placeholder="UUID" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Run id</label>
          <Input value={runId} onChange={(e) => setRunId(e.target.value)} placeholder="UUID" />
        </div>
        <Button variant="outline" onClick={() => q.refetch()} disabled={q.isFetching}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${q.isFetching ? "animate-spin" : ""}`} />
          Reload
        </Button>
        <Button variant="outline" onClick={exportCsv} disabled={!q.data?.length}>
          <Download className="h-3.5 w-3.5 mr-1.5" />
          CSV
        </Button>
      </div>

      {q.error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {(q.error as Error).message}
        </div>
      )}

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="p-2">Time</th>
              <th className="p-2">Decision</th>
              <th className="p-2">Code</th>
              <th className="p-2">Title</th>
              <th className="p-2">S/E</th>
              <th className="p-2">Msg</th>
              <th className="p-2">Details</th>
            </tr>
          </thead>
          <tbody>
            {(q.data ?? []).map((r: any) => (
              <tr key={r.id} className="border-t border-border align-top">
                <td className="p-2 whitespace-nowrap text-muted-foreground">
                  {new Date(r.created_at).toLocaleString()}
                </td>
                <td className="p-2"><DecisionBadge d={r.decision} /></td>
                <td className="p-2 font-mono">{r.reason_code}</td>
                <td className="p-2">{r.title_slug ?? r.title_id?.slice(0, 8) ?? "—"}</td>
                <td className="p-2 whitespace-nowrap">
                  {r.season_number ?? "?"}×{r.episode_number ?? "?"}
                </td>
                <td className="p-2">{r.message_id ?? "—"}</td>
                <td className="p-2 font-mono max-w-[280px] truncate" title={JSON.stringify(r.details)}>
                  {JSON.stringify(r.details)}
                </td>
              </tr>
            ))}
            {q.data && q.data.length === 0 && (
              <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">No trace rows yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Link to="/admin" className="text-sm text-primary inline-block">← Back to admin</Link>
    </div>
  );
}

function DecisionBadge({ d }: { d: string }) {
  const color =
    d === "promoted" ? "text-emerald-500" :
    d === "matched" ? "text-blue-400" :
    d === "rejected" || d === "error" ? "text-red-500" :
    d === "hidden" ? "text-amber-500" :
    "text-muted-foreground";
  return <span className={`uppercase font-semibold ${color}`}>{d}</span>;
}
