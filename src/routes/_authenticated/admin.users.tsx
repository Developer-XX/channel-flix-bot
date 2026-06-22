import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, keepPreviousData } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Trash2, RefreshCw, Send, Webhook, Users as UsersIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import {
  adminListUsers,
  adminDeleteUser,
  adminBroadcastOverview,
  adminSendTextBroadcast,
  adminRegisterTelegramWebhook,
} from "@/lib/admin-users.functions";
import { rotateTelegramBotToken } from "@/lib/telegram-rotate.functions";

export const Route = createFileRoute("/_authenticated/admin/users")({
  component: AdminUsersPage,
});

function AdminUsersPage() {
  const listFn = useServerFn(adminListUsers);
  const delFn = useServerFn(adminDeleteUser);
  const overviewFn = useServerFn(adminBroadcastOverview);
  const sendTextFn = useServerFn(adminSendTextBroadcast);
  const registerWebhookFn = useServerFn(adminRegisterTelegramWebhook);
  const rotateTokenFn = useServerFn(rotateTelegramBotToken);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [broadcastText, setBroadcastText] = useState("");
  const [newToken, setNewToken] = useState("");
  const [showToken, setShowToken] = useState(false);

  const users = useQuery({
    queryKey: ["admin-users", page, search],
    queryFn: () => listFn({ data: { page, perPage: 50, search: search || undefined } }),
    placeholderData: keepPreviousData,
    retry: 1,
  });

  const overview = useQuery({
    queryKey: ["admin-broadcast-overview"],
    queryFn: () => overviewFn(),
    refetchInterval: 30_000,
    retry: 1,
  });

  const del = useMutation({
    mutationFn: (userId: string) => delFn({ data: { userId, confirm: "DELETE" as const } }),
    onSuccess: () => { toast.success("User deleted"); users.refetch(); },
    onError: (e: any) => toast.error(e?.message ?? "Delete failed"),
  });

  const sendBroadcast = useMutation({
    mutationFn: (text: string) => sendTextFn({ data: { text } }),
    onSuccess: (r) => {
      toast.success(`Broadcast: ${r.ok} sent · ${r.fail} failed (${r.total} total)`);
      setBroadcastText("");
      overview.refetch();
    },
    onError: (e: any) => toast.error(e?.message ?? "Broadcast failed"),
  });

  const setHook = useMutation({
    mutationFn: () => registerWebhookFn(),
    onSuccess: (r) => toast.success(`Webhook registered: ${r.webhookUrl}${r.botUsername ? ` (@${r.botUsername})` : ""}`),
    onError: (e: any) => toast.error(e?.message ?? "setWebhook failed"),
  });

  const rotate = useMutation({
    mutationFn: (token: string) => rotateTokenFn({ data: { newToken: token, confirm: "ROTATE" as const } }),
    onSuccess: (r) => {
      const prev = r.previousBot ? `@${r.previousBot.username ?? r.previousBot.id}` : "(none)";
      const next = `@${r.newBot.username ?? r.newBot.id}`;
      const hook = r.webhook.ok ? `webhook → ${r.webhook.url}` : `webhook FAILED: ${r.webhook.error}`;
      toast.success(`Rotated ${prev} → ${next} · old cleared: ${String(r.oldWebhookCleared)} · ${hook}`, { duration: 10000 });
      setNewToken("");
    },
    onError: (e: any) => toast.error(e?.message ?? "Rotation failed"),
  });

  return (
    <div className="p-3 md:p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Users & Broadcast</h1>
          <p className="text-sm text-muted-foreground">
            Delete website users, broadcast to Telegram bot subscribers, and re-register the bot webhook after rotating the token.
          </p>
        </div>
      </div>

      {/* Telegram bot tools */}
      <section className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Webhook className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Telegram bot</h2>
          <Link to="/admin/settings" className="text-xs text-primary ml-auto hover:underline">
            Change bot token →
          </Link>
        </div>
        <p className="text-xs text-muted-foreground">
          After rotating <code>TELEGRAM_BOT_TOKEN</code> in Settings, click below to re-register the webhook so the new bot receives updates.
        </p>
        <Button size="sm" onClick={() => setHook.mutate()} disabled={setHook.isPending}>
          <Webhook className={`h-4 w-4 mr-2 ${setHook.isPending ? "animate-spin" : ""}`} />
          {setHook.isPending ? "Registering…" : "Register / refresh webhook"}
        </Button>
      </section>

      {/* Broadcast */}
      <section className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Send className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Broadcast to bot subscribers</h2>
        </div>
        <div className="text-xs text-muted-foreground space-y-1">
          {overview.data ? (
            <p>
              <span className="font-medium text-foreground">{overview.data.subscribers.active}</span> active subscribers
              {" · "}{overview.data.subscribers.blocked} blocked
              {" · "}{overview.data.subscribers.total} total
            </p>
          ) : <Skeleton className="h-4 w-48" />}
          <p>For forwarded posts: forward the post to the bot in Telegram, then reply <code>/broadcast</code>.</p>
        </div>
        <div className="flex gap-2 items-start">
          <textarea
            className="flex-1 min-h-[80px] rounded-md border border-border bg-background p-2 text-sm"
            placeholder="Send text to every subscriber…"
            value={broadcastText}
            onChange={(e) => setBroadcastText(e.target.value)}
          />
          <Button
            onClick={() => {
              if (!broadcastText.trim()) return;
              if (!confirm(`Send to ${overview.data?.subscribers.active ?? "?"} subscribers?`)) return;
              sendBroadcast.mutate(broadcastText.trim());
            }}
            disabled={sendBroadcast.isPending || !broadcastText.trim()}
          >
            <Send className="h-4 w-4 mr-2" />
            {sendBroadcast.isPending ? "Sending…" : "Send"}
          </Button>
        </div>

        {overview.data && overview.data.recentRuns.length > 0 && (
          <div className="pt-2">
            <div className="text-xs font-medium mb-1">Recent broadcasts</div>
            <div className="space-y-1">
              {overview.data.recentRuns.slice(0, 8).map((r: any) => (
                <div key={r.id} className="text-[11px] font-mono text-muted-foreground border border-border/60 rounded px-2 py-1">
                  <span className="text-foreground">{new Date(r.started_at).toLocaleString()}</span>
                  {" · "}{r.source_kind}
                  {" · "}<span className="text-green-500">✓{r.success_count}</span>
                  {" · "}<span className="text-destructive">✗{r.failed_count}</span>
                  {" / "}{r.total_targets}
                  {r.text_preview && <span className="text-muted-foreground/70"> · "{r.text_preview.slice(0, 60)}"</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Users */}
      <section className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <UsersIcon className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Website users</h2>
          <Input
            className="ml-auto max-w-xs"
            placeholder="Search by email or user id"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
          <Button size="sm" variant="outline" onClick={() => users.refetch()} disabled={users.isFetching}>
            <RefreshCw className={`h-4 w-4 ${users.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {users.isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        )}
        {users.error && (
          <pre className="text-xs bg-destructive/10 text-destructive p-2 rounded">{(users.error as Error).message}</pre>
        )}

        {users.data && (
          <>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-2 text-left">Email</th>
                    <th className="px-3 py-2 text-left">Roles</th>
                    <th className="px-3 py-2 text-left">Premium</th>
                    <th className="px-3 py-2 text-left">Created</th>
                    <th className="px-3 py-2 text-left">Last sign-in</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.data.users.map((u) => (
                    <tr key={u.id} className="border-t border-border align-top">
                      <td className="px-3 py-2">
                        <div className="font-medium">{u.email ?? "—"}</div>
                        <div className="font-mono text-[10px] text-muted-foreground break-all">{u.id}</div>
                      </td>
                      <td className="px-3 py-2">
                        {u.roles.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : u.roles.map((r) => (
                          <Badge key={r} variant={r === "admin" ? "default" : "secondary"} className="mr-1">{r}</Badge>
                        ))}
                      </td>
                      <td className="px-3 py-2">
                        {u.isPremium ? (
                          <Badge variant="default">{u.premiumUntil ? `until ${new Date(u.premiumUntil).toLocaleDateString()}` : "active"}</Badge>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{new Date(u.createdAt).toLocaleDateString()}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{u.lastSignInAt ? new Date(u.lastSignInAt).toLocaleDateString() : "—"}</td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={del.isPending}
                          onClick={() => {
                            if (!confirm(`Permanently delete ${u.email ?? u.id}?\n\nAll their data (profile, downloads, links) will be cascade-deleted. This cannot be undone.`)) return;
                            del.mutate(u.id);
                          }}
                        >
                          <Trash2 className="h-3 w-3 mr-1" /> Delete
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between text-sm">
              <div className="text-muted-foreground">
                Page {page} · showing {users.data.users.length} of {users.data.total.toLocaleString()}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  <ChevronLeft className="h-4 w-4" /> Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page * 50 >= users.data.total}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
