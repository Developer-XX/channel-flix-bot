import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Download, RefreshCw, Clock, CheckCircle2, AlertTriangle, ExternalLink } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import { getMyDownloadHistory } from "@/lib/download-history.functions";
import { requestDownload } from "@/lib/downloads.functions";

export const Route = createFileRoute("/_authenticated/account/downloads")({
  component: DownloadsPage,
});

function useTick(ms = 1000) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

function DownloadsPage() {
  const fn = useServerFn(getMyDownloadHistory);
  const resend = useServerFn(requestDownload);
  const q = useQuery({
    queryKey: ["my-downloads"],
    queryFn: () => fn(),
    refetchInterval: 30_000,
  });
  useTick(1000);
  const [busyFile, setBusyFile] = useState<string | null>(null);

  const onResend = async (fileId: string) => {
    setBusyFile(fileId);
    try {
      const r = await resend({ data: { mediaFileId: fileId } } as never);
      if ((r as any).ok) {
        if ((r as any).reused) toast.info("Already sent — check Telegram");
        else if ((r as any).queued) toast.info("Queued — will retry shortly");
        else toast.success("Sent to Telegram");
        await q.refetch();
      } else {
        toast.error((r as any).reason ?? "Resend failed");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Resend failed");
    } finally {
      setBusyFile(null);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-6 max-w-4xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Download className="h-6 w-6" /> Download history
            </h1>
            <p className="text-sm text-muted-foreground">
              Your recent file requests. Resend any item to Telegram — repeated clicks within {q.data?.cooldownSec ?? 8}s
              are de-duplicated automatically.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
            <RefreshCw className={`h-4 w-4 mr-1 ${q.isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>

        {q.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {q.error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            Failed to load: {(q.error as Error).message}
          </div>
        )}
        {q.data && q.data.rows.length === 0 && (
          <div className="rounded-md border border-border p-6 text-center text-sm text-muted-foreground">
            No downloads yet. <Link to="/" className="text-primary underline">Browse titles →</Link>
          </div>
        )}
        <div className="space-y-2">
          {q.data?.rows.map((r) => {
            const cooldownLeft = Math.max(0, r.cooldownRemainingMs - 0);
            // Recompute against current time so countdown re-renders.
            const sentAtKey = r.deliveredAt ?? null;
            const liveCooldown = sentAtKey
              ? Math.max(0, (q.data!.cooldownSec * 1000) - (Date.now() - new Date(sentAtKey).getTime()))
              : cooldownLeft;
            const disabled = busyFile === r.fileId || liveCooldown > 0 || r.queueStatus === "sending" || r.queueStatus === "queued";
            return (
              <div key={r.id} className="rounded-md border border-border bg-card p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {r.titleSlug ? (
                        <Link to={`/title/${r.titleSlug}` as never} className="hover:text-primary inline-flex items-center gap-1 truncate">
                          {r.title ?? r.fileName ?? "Untitled"} <ExternalLink className="h-3 w-3" />
                        </Link>
                      ) : (
                        <span className="truncate">{r.title ?? r.fileName ?? "Untitled"}</span>
                      )}
                      {r.quality && <span className="text-xs rounded-full bg-muted px-2 py-0.5">{r.quality}</span>}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground truncate">{r.fileName}</div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                      <span className="text-muted-foreground">
                        {new Date(r.createdAt).toLocaleString()}
                      </span>
                      <StatusBadge status={r.status} queueStatus={r.queueStatus} />
                      <span className="text-muted-foreground">Resends: <b>{r.resendCount}</b>{r.reusedCount > 0 && <> ({r.reusedCount} de-duped)</>}</span>
                      {r.attemptCount > 1 && (
                        <span className="text-muted-foreground">Attempts: <b>{r.attemptCount}</b></span>
                      )}
                    </div>
                    {r.error && (
                      <div className="mt-1 text-xs text-destructive break-all">{r.error}</div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <Button
                      size="sm"
                      onClick={() => onResend(r.fileId)}
                      disabled={disabled}
                    >
                      {busyFile === r.fileId ? (
                        <><RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" /> Sending…</>
                      ) : liveCooldown > 0 ? (
                        <><Clock className="h-3.5 w-3.5 mr-1" /> Wait {Math.ceil(liveCooldown / 1000)}s</>
                      ) : r.queueStatus === "queued" ? (
                        <><Clock className="h-3.5 w-3.5 mr-1" /> Queued</>
                      ) : (
                        <>Resend</>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function StatusBadge({ status, queueStatus }: { status: string | null; queueStatus: string | null }) {
  const s = queueStatus ?? status ?? "unknown";
  let className = "bg-muted text-muted-foreground";
  let Icon = Clock;
  if (s === "delivered" || s === "sent") {
    className = "bg-emerald-500/15 text-emerald-500";
    Icon = CheckCircle2;
  } else if (s === "failed" || s === "blocked" || s === "not_found") {
    className = "bg-destructive/15 text-destructive";
    Icon = AlertTriangle;
  } else if (s === "queued" || s === "sending") {
    className = "bg-amber-500/15 text-amber-500";
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${className}`}>
      <Icon className="h-3 w-3" /> {s}
    </span>
  );
}
