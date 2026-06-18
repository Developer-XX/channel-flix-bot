import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowLeft, MessageCircle, Send, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { adminListTickets, adminStartTicketWithUser, getTicket, replyTicket } from "@/lib/support.functions";
import { adminSearchUsers } from "@/lib/premium.functions";

export const Route = createFileRoute("/_authenticated/admin/support")({
  component: SupportAdmin,
});

function SupportAdmin() {
  const list = useServerFn(adminListTickets);
  const get = useServerFn(getTicket);
  const reply = useServerFn(replyTicket);
  const startWith = useServerFn(adminStartTicketWithUser);
  const search = useServerFn(adminSearchUsers);

  const [status, setStatus] = useState<"open"|"pending_user"|"resolved"|"closed"|"all">("open");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [newQuery, setNewQuery] = useState("");
  const [newSubject, setNewSubject] = useState("");
  const [newBody, setNewBody] = useState("");
  const [newUserId, setNewUserId] = useState<string | null>(null);

  const listQ = useQuery({ queryKey: ["admin-tickets", status], queryFn: () => list({ data: { status } }), retry: false, refetchInterval: 20_000 });
  const ticketQ = useQuery({
    queryKey: ["admin-ticket", activeId], queryFn: () => get({ data: { id: activeId! } }),
    enabled: !!activeId, retry: false, refetchInterval: 10_000,
  });
  const usersQ = useQuery({
    queryKey: ["admin-support-users", newQuery],
    queryFn: () => search({ data: { q: newQuery } }), enabled: newOpen, retry: false,
  });

  const replyMut = useMutation({
    mutationFn: (vars: { body: string; statusOverride?: any }) =>
      reply({ data: { ticketId: activeId!, body: vars.body, statusOverride: vars.statusOverride } }),
    onSuccess: () => { setReplyBody(""); ticketQ.refetch(); listQ.refetch(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const startMut = useMutation({
    mutationFn: () => startWith({ data: { userId: newUserId!, subject: newSubject, body: newBody } }),
    onSuccess: (r) => { setActiveId(r.id); setNewOpen(false); setNewSubject(""); setNewBody(""); setNewUserId(null); listQ.refetch(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-3 sm:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/admin"><Button size="sm" variant="ghost"><ArrowLeft className="h-3 w-3 mr-1" /> Admin</Button></Link>
        <h1 className="text-lg sm:text-2xl font-bold flex items-center gap-2"><MessageCircle className="h-5 w-5 text-primary" /> Support</h1>
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => setNewOpen((v) => !v)}><Plus className="h-3 w-3 mr-1" /> Message a user</Button>
      </div>

      {newOpen && (
        <section className="rounded-md border border-border p-3 space-y-2">
          <div className="text-xs font-semibold">Start conversation with user</div>
          <Input placeholder="Search user by name…" value={newQuery} onChange={(e) => setNewQuery(e.target.value)} />
          <div className="max-h-32 overflow-auto border border-border rounded">
            {(usersQ.data ?? []).map((u: any) => (
              <button key={u.id} className={`block w-full text-left px-2 py-1 text-xs hover:bg-surface ${newUserId === u.id ? "bg-surface" : ""}`} onClick={() => setNewUserId(u.id)}>
                {u.display_name ?? "(no name)"} <span className="text-muted-foreground font-mono text-[10px]">{u.id.slice(0,8)}</span>
              </button>
            ))}
          </div>
          <Input placeholder="Subject" value={newSubject} onChange={(e) => setNewSubject(e.target.value)} />
          <Textarea rows={3} placeholder="Message…" value={newBody} onChange={(e) => setNewBody(e.target.value)} />
          <Button size="sm" disabled={!newUserId || !newSubject || !newBody || startMut.isPending} onClick={() => startMut.mutate()}>Send</Button>
        </section>
      )}

      <div className="grid md:grid-cols-[280px_1fr] gap-4">
        <aside className="space-y-2">
          <div className="flex flex-wrap gap-1">
            {(["open","pending_user","resolved","closed","all"] as const).map((s) => (
              <Button key={s} size="sm" variant={status === s ? "default" : "outline"} onClick={() => setStatus(s)}>{s}</Button>
            ))}
          </div>
          <ul className="rounded-md border border-border divide-y divide-border max-h-[60vh] overflow-auto">
            {(listQ.data ?? []).map((t: any) => (
              <li key={t.id}>
                <button className={`w-full text-left px-3 py-2 text-xs hover:bg-surface ${activeId === t.id ? "bg-surface" : ""}`} onClick={() => setActiveId(t.id)}>
                  <div className="font-medium truncate flex items-center gap-1">
                    {t.subject}
                    {t.unread_for_admin && <span className="text-primary">●</span>}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {t.user_display_name ?? t.user_id.slice(0,8)} · {new Date(t.last_message_at).toLocaleString()} · {t.status}
                  </div>
                </button>
              </li>
            ))}
            {(listQ.data ?? []).length === 0 && <li className="px-3 py-3 text-xs text-muted-foreground">No tickets.</li>}
          </ul>
        </aside>

        <main className="rounded-md border border-border min-h-[400px] flex flex-col">
          {!activeId && <div className="m-auto text-sm text-muted-foreground">Select a ticket</div>}
          {activeId && ticketQ.data && (
            <>
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <div>
                  <div className="font-semibold">{(ticketQ.data as any).ticket.subject}</div>
                  <div className="text-[11px] text-muted-foreground">{(ticketQ.data as any).ticket.status}</div>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => replyMut.mutate({ body: "(marked resolved)", statusOverride: "resolved" })}>Resolve</Button>
                  <Button size="sm" variant="outline" onClick={() => replyMut.mutate({ body: "(closed)", statusOverride: "closed" })}>Close</Button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[55vh]">
                {(ticketQ.data as any).messages.map((m: any) => (
                  <div key={m.id} className={`flex ${m.sender_role === "admin" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.sender_role === "admin" ? "bg-primary text-primary-foreground" : "bg-surface text-foreground"}`}>
                      <div className="whitespace-pre-wrap break-words">{m.body}</div>
                      <div className="text-[10px] opacity-70 mt-1">{m.sender_role} · {new Date(m.created_at).toLocaleString()}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="border-t border-border p-3 flex gap-2">
                <Textarea rows={2} value={replyBody} onChange={(e) => setReplyBody(e.target.value)} placeholder="Reply…" />
                <Button onClick={() => replyMut.mutate({ body: replyBody })} disabled={!replyBody.trim() || replyMut.isPending}>
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
