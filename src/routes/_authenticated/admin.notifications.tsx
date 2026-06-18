import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowLeft, Bell, RefreshCw, Check, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { listAdminNotifications, acknowledgeNotification, runShortenerAlertCheck } from "@/lib/alerts.functions";
import { OnboardingChart } from "@/components/OnboardingChart";

export const Route = createFileRoute("/_authenticated/admin/notifications")({
  component: NotificationsAdmin,
});

function NotificationsAdmin() {
  const list = useServerFn(listAdminNotifications);
  const ack = useServerFn(acknowledgeNotification);
  const run = useServerFn(runShortenerAlertCheck);
  const [showAcked, setShowAcked] = useState(false);
  const q = useQuery({
    queryKey: ["admin-notifications", showAcked],
    queryFn: () => list({ data: { includeAcked: showAcked } }),
    retry: false, refetchInterval: 60_000,
  });
  const ackMut = useMutation({
    mutationFn: (id: string) => ack({ data: { id } }),
    onSuccess: () => q.refetch(),
    onError: (e: Error) => toast.error(e.message),
  });
  const checkMut = useMutation({
    mutationFn: () => run(),
    onSuccess: (r) => { toast.success(r.created.length ? `Created ${r.created.length} alert(s)` : "All providers within threshold"); q.refetch(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-3 sm:p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/admin"><Button size="sm" variant="ghost"><ArrowLeft className="h-3 w-3 mr-1" /> Admin</Button></Link>
        <h1 className="text-lg sm:text-2xl font-bold flex items-center gap-2"><Bell className="h-5 w-5 text-primary" /> Notifications</h1>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowAcked((v) => !v)}>{showAcked ? "Hide acked" : "Show acked"}</Button>
          <Button size="sm" onClick={() => checkMut.mutate()} disabled={checkMut.isPending}>
            <RefreshCw className={`h-3 w-3 mr-1 ${checkMut.isPending ? "animate-spin" : ""}`} /> Run alert check
          </Button>
        </div>
      </div>

      <section className="space-y-2">
        {(q.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">No notifications.</p>}
        {(q.data ?? []).map((n: any) => (
          <div key={n.id} className={`rounded-md border p-3 grid grid-cols-[auto_1fr_auto] gap-3 items-start ${
            n.severity === "error" ? "border-red-500/40 bg-red-500/5" :
            n.severity === "warn"  ? "border-amber-500/40 bg-amber-500/5" : "border-border"
          }`}>
            <AlertTriangle className={`h-5 w-5 ${n.severity === "error" ? "text-red-500" : n.severity === "warn" ? "text-amber-500" : "text-muted-foreground"}`} />
            <div className="min-w-0">
              <div className="text-sm font-semibold">{n.title}</div>
              <div className="text-xs text-muted-foreground">{n.body}</div>
              <div className="text-[10px] text-muted-foreground mt-1">{n.kind} · {new Date(n.created_at).toLocaleString()}</div>
            </div>
            {!n.acknowledged_at ? (
              <Button size="sm" variant="outline" onClick={() => ackMut.mutate(n.id)}><Check className="h-3 w-3" /></Button>
            ) : (
              <span className="text-[10px] text-muted-foreground self-center">acked</span>
            )}
          </div>
        ))}
      </section>

      <OnboardingChart />
    </div>
  );
}
