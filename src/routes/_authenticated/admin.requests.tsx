import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/admin/requests")({
  component: RequestsAdmin,
});

const STATUSES = ["pending", "approved", "rejected", "fulfilled"] as const;

function RequestsAdmin() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["admin-requests"],
    queryFn: async () => {
      const { data } = await supabase
        .from("content_requests")
        .select("id, title, category, notes, status, created_at, user_id")
        .order("created_at", { ascending: false })
        .limit(200);
      return data ?? [];
    },
  });

  const update = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("content_requests").update({ status: status as never }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-requests"] });
      toast.success("Updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-6 md:p-10 max-w-5xl">
      <h1 className="font-display text-3xl font-bold">Content requests</h1>
      <p className="mt-1 text-muted-foreground">{list.data?.length ?? 0} total</p>

      <div className="mt-8 space-y-3">
        {list.isLoading && <p className="text-muted-foreground">Loading…</p>}
        {!list.isLoading && list.data?.length === 0 && (
          <p className="text-muted-foreground rounded-xl border border-dashed border-border p-8 text-center">No requests yet.</p>
        )}
        {list.data?.map((r) => (
          <div key={r.id} className="rounded-xl border border-border bg-card p-4 flex flex-col md:flex-row md:items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="font-semibold">{r.title}</div>
              <div className="text-xs text-muted-foreground capitalize mt-0.5">
                {r.category ?? "uncategorized"} · {new Date(r.created_at).toLocaleDateString()}
              </div>
              {r.notes && <div className="text-sm text-muted-foreground mt-2">{r.notes}</div>}
            </div>
            <div className="flex items-center gap-2">
              <select
                value={r.status}
                onChange={(e) => update.mutate({ id: r.id, status: e.target.value })}
                className="bg-surface border border-border rounded px-2 py-1.5 text-xs"
              >
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
