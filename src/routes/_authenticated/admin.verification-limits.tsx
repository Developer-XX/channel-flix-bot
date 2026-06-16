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

  function downloadCsv() {
    const rows = q.data ?? [];
    const header = ["created_at", "user_id", "media_file_id", "used", "capacity", "retry_in_minutes", "token"];
    const escape = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header.join(",")];
    for (const r of rows) {
      const retryMin = r.parsed?.retryAfterMs ? Math.ceil(r.parsed.retryAfterMs / 60000) : "";
      lines.push([
        r.created_at, r.user_id ?? "", r.parsed?.mediaFileId ?? "",
        r.parsed?.used ?? "", r.parsed?.capacity ?? "", retryMin,
        r.short_url_returned ?? "",
      ].map(escape).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `verification-limits-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Verification rate-limit log</h1>
          <p className="text-sm text-muted-foreground">
            Every time a user hits the verification cap, we record it here with the file context that triggered it.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => q.refetch()}>Refresh</Button>
          <Button size="sm" onClick={downloadCsv} disabled={!q.data?.length}>Export CSV</Button>
        </div>
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
