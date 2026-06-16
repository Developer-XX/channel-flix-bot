import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getTitleDebug } from "@/lib/telegram.functions";
import { ChevronDown, Wrench } from "lucide-react";

export function TitleDebugPanel({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);

  // Check admin client-side (RLS protects the server fn regardless).
  const adminQ = useQuery({
    queryKey: ["is-admin-check"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return false;
      const { data } = await supabase.rpc("has_role", { _user_id: u.user.id, _role: "admin" });
      return Boolean(data);
    },
  });

  const debugFn = useServerFn(getTitleDebug);
  const debugQ = useQuery({
    queryKey: ["title-debug", slug],
    enabled: open && adminQ.data === true,
    queryFn: () => debugFn({ data: { slug } }),
  });

  if (!adminQ.data) return null;

  return (
    <section className="mx-auto max-w-7xl px-4 md:px-6 py-6">
      <div className="rounded-xl border border-dashed border-amber-500/40 bg-amber-500/5">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="w-full flex items-center justify-between px-4 py-3 text-left"
        >
          <div className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-amber-500" />
            <span className="font-semibold text-sm">Admin · Title Debug</span>
          </div>
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {open && (
          <div className="px-4 pb-4 space-y-3 text-sm">
            {debugQ.isLoading && <p className="text-muted-foreground">Loading…</p>}
            {debugQ.error && <p className="text-destructive text-xs">{(debugQ.error as Error).message}</p>}
            {debugQ.data && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  <Stat label="Category" value={debugQ.data.title.category ?? "—"} />
                  <Stat label="Status" value={debugQ.data.title.status ?? "—"} />
                  <Stat label="Files linked" value={String(debugQ.data.files.length)} />
                  <Stat label="Aliases" value={String(debugQ.data.aliases.length)} />
                </div>
                <div className="text-xs">
                  <span className="text-muted-foreground">Query filters required:</span>{" "}
                  <code>status=published</code> · <code>is_active=true</code> · <code>category={debugQ.data.filtersSummary.category ?? "any"}</code>
                </div>

                <div>
                  <div className="text-xs uppercase text-muted-foreground mt-2 mb-1">Linked files</div>
                  {debugQ.data.files.length === 0 && (
                    <p className="text-xs text-amber-600">No media_files rows — nothing will appear in Downloads.</p>
                  )}
                  <ul className="text-xs space-y-0.5">
                    {debugQ.data.files.slice(0, 20).map((f: any) => (
                      <li key={f.id} className="font-mono">
                        {f.episodes?.seasons?.season_number != null
                          ? `S${String(f.episodes.seasons.season_number).padStart(2, "0")}`
                          : "—"}
                        {f.episodes?.episode_number != null ? `E${String(f.episodes.episode_number).padStart(2, "0")}` : ""}{" "}
                        · {f.file_name} {f.is_active ? "" : "[inactive]"}
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <div className="text-xs uppercase text-muted-foreground mt-3 mb-1">
                    Nearby ingest rows ({debugQ.data.candidates.length})
                  </div>
                  <div className="max-h-72 overflow-auto border border-border rounded">
                    <table className="w-full text-xs">
                      <thead className="bg-surface/60 text-muted-foreground">
                        <tr>
                          <th className="text-left p-1">Parsed title</th>
                          <th>S/E</th>
                          <th>Score</th>
                          <th>Status</th>
                          <th>Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {debugQ.data.candidates.slice(0, 25).map((c: any) => (
                          <tr key={c.row.id} className="border-t border-border/50">
                            <td className="p-1 truncate max-w-[220px]">{c.row.parsed_title ?? "—"}</td>
                            <td className="text-center">
                              {c.row.parsed_season != null
                                ? `S${c.row.parsed_season}${c.row.parsed_episode != null ? `E${c.row.parsed_episode}` : ""}`
                                : "—"}
                            </td>
                            <td className="text-center font-semibold">{c.adjusted.toFixed(2)}</td>
                            <td className="text-center">
                              <Badge variant="secondary">{c.row.match_status}</Badge>
                            </td>
                            <td className="text-[10px] text-muted-foreground">{c.reasons.join("; ") || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
            <div className="pt-2">
              <Button size="sm" variant="outline" onClick={() => debugQ.refetch()}>
                Refresh debug
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border bg-background/40 px-2 py-1.5">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
