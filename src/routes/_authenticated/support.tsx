import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { MessageCircle, ArrowLeft, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { listMyTickets, createTicket, getTicket, replyTicket } from "@/lib/support.functions";

export const Route = createFileRoute("/_authenticated/support")({
  component: SupportPage,
});

function SupportPage() {
  const list = useServerFn(listMyTickets);
  const create = useServerFn(createTicket);
  const get = useServerFn(getTicket);
  const reply = useServerFn(replyTicket);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [replyBody, setReplyBody] = useState("");

  const listQ = useQuery({ queryKey: ["my-tickets"], queryFn: () => list(), retry: false });
  const ticketQ = useQuery({
    queryKey: ["ticket", activeId], queryFn: () => get({ data: { id: activeId! } }),
    enabled: !!activeId, retry: false, refetchInterval: 15_000,
  });

  const createMut = useMutation({
    mutationFn: () => create({ data: { subject, body } }),
    onSuccess: (r) => { setSubject(""); setBody(""); setActiveId(r.id); listQ.refetch(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const replyMut = useMutation({
    mutationFn: () => reply({ data: { ticketId: activeId!, body: replyBody } }),
    onSuccess: () => { setReplyBody(""); ticketQ.refetch(); listQ.refetch(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="min-h-screen pt-20 pb-16 px-4">
      <div className="max-w-5xl mx-auto grid md:grid-cols-[260px_1fr] gap-4">
        <aside className="space-y-3">
          <div className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-bold">Help & Support</h1>
          </div>
          <section className="rounded-md border border-border p-3 space-y-2">
            <div className="text-xs font-semibold">New ticket</div>
            <Input placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
            <Textarea placeholder="Describe your issue…" rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
            <Button size="sm" className="w-full" disabled={!subject.trim() || !body.trim() || createMut.isPending} onClick={() => createMut.mutate()}>
              Send
            </Button>
          </section>
          <section className="rounded-md border border-border">
            <div className="px-3 py-2 text-xs font-semibold border-b border-border">My tickets</div>
            <ul className="max-h-[420px] overflow-auto">
              {(listQ.data ?? []).map((t: any) => (
                <li key={t.id}>
                  <button
                    className={`w-full text-left px-3 py-2 text-xs border-b border-border/50 hover:bg-surface ${activeId === t.id ? "bg-surface" : ""}`}
                    onClick={() => setActiveId(t.id)}
                  >
                    <div className="font-medium truncate">{t.subject}</div>
                    <div className="text-[10px] text-muted-foreground flex justify-between">
                      <span>{t.status}</span>
                      {t.unread_for_user && <span className="text-primary font-bold">●</span>}
                    </div>
                  </button>
                </li>
              ))}
              {(listQ.data ?? []).length === 0 && (
                <li className="px-3 py-3 text-xs text-muted-foreground">No tickets yet.</li>
              )}
            </ul>
          </section>
          <Link to="/" className="text-xs text-primary inline-flex items-center gap-1"><ArrowLeft className="h-3 w-3" /> Home</Link>
        </aside>

        <main className="rounded-md border border-border min-h-[400px] flex flex-col">
          {!activeId && (
            <div className="m-auto text-sm text-muted-foreground">Select or create a ticket to chat.</div>
          )}
          {activeId && ticketQ.data && (
            <>
              <div className="px-4 py-3 border-b border-border">
                <div className="font-semibold">{(ticketQ.data as any).ticket.subject}</div>
                <div className="text-[11px] text-muted-foreground">status: {(ticketQ.data as any).ticket.status}</div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[60vh]">
                {(ticketQ.data as any).messages.map((m: any) => (
                  <div key={m.id} className={`flex ${m.sender_role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.sender_role === "admin" ? "bg-surface text-foreground" : "bg-primary text-primary-foreground"}`}>
                      <div className="whitespace-pre-wrap break-words">{m.body}</div>
                      <div className="text-[10px] opacity-70 mt-1">{new Date(m.created_at).toLocaleString()}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="border-t border-border p-3 flex gap-2">
                <Textarea rows={2} value={replyBody} onChange={(e) => setReplyBody(e.target.value)} placeholder="Type a reply…" />
                <Button onClick={() => replyMut.mutate()} disabled={!replyBody.trim() || replyMut.isPending}>
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
