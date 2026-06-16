import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { CATEGORIES } from "@/lib/categories";

export const Route = createFileRoute("/request")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Request content — StreamVault" },
      { name: "description", content: "Request a title and we'll add it to the vault." },
    ],
  }),
  component: RequestPage,
});

function RequestPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string>("movie");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      navigate({ to: "/auth" });
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("content_requests").insert({
      user_id: user.id,
      title: title.trim(),
      category: category as never,
      notes: notes.trim() || null,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Request submitted. We'll review it shortly.");
    setTitle("");
    setNotes("");
  };

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1 pt-28 pb-16">
        <div className="mx-auto max-w-2xl px-4 md:px-6">
          <h1 className="font-display text-3xl md:text-4xl font-bold">Request a title</h1>
          <p className="mt-2 text-muted-foreground">Tell us what you're looking for. We'll review and notify you.</p>

          {!loading && !user && (
            <div className="mt-6 rounded-xl border border-border bg-surface/50 p-4 text-sm">
              You need to <a href="/auth" className="text-primary underline">sign in</a> to submit a request.
            </div>
          )}

          <form onSubmit={submit} className="mt-8 space-y-5">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Title</label>
              <input
                required
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Spirited Away"
                className="mt-1 h-11 w-full rounded-md bg-surface px-3 text-sm outline-none border border-border focus:border-ring focus:ring-2 focus:ring-ring/40 transition"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="mt-1 h-11 w-full rounded-md bg-surface px-3 text-sm outline-none border border-border focus:border-ring transition"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.slug} value={c.slug}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Notes (optional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={1000}
                rows={4}
                placeholder="Quality preference, year, language…"
                className="mt-1 w-full rounded-md bg-surface px-3 py-2 text-sm outline-none border border-border focus:border-ring focus:ring-2 focus:ring-ring/40 transition"
              />
            </div>
            <Button type="submit" disabled={busy || !user} className="bg-gradient-primary text-primary-foreground border-0 h-11 px-6">
              {busy ? "Submitting…" : "Submit request"}
            </Button>
          </form>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
