import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  listTelegramIngest,
  promoteIngest,
  ignoreIngest,
  setTelegramWebhook,
  getTelegramWebhookInfo,
} from "@/lib/telegram.functions";

export const Route = createFileRoute("/_authenticated/admin/telegram")({
  component: TelegramAdmin,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Error: {error.message}</div>,
  notFoundComponent: () => <div className="p-6">Not found</div>,
});

function TelegramAdmin() {
  const router = useRouter();
  const list = useServerFn(listTelegramIngest);
  const promote = useServerFn(promoteIngest);
  const ignore = useServerFn(ignoreIngest);
  const setHook = useServerFn(setTelegramWebhook);
  const getHook = useServerFn(getTelegramWebhookInfo);

  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "matched" | "unmatched" | "ignored">("all");
  const [baseUrl, setBaseUrl] = useState(typeof window !== "undefined" ? window.location.origin : "");

  const ingest = useQuery({
    queryKey: ["tg-ingest", statusFilter],
    queryFn: () => list({ data: { status: statusFilter } }),
  });

  const hook = useQuery({
    queryKey: ["tg-webhook-info"],
    queryFn: () => getHook(),
  });

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold">Telegram Sync</h1>
        <p className="text-sm text-muted-foreground">
          Posts from configured channels appear here. Matched items can be promoted into the catalog.
        </p>
      </div>

      <section className="rounded-lg border border-border p-4 space-y-3">
        <h2 className="font-semibold">Webhook</h2>
        <div className="flex flex-wrap gap-2 items-center">
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://project--<id>-dev.lovable.app"
            className="max-w-md"
          />
          <Button
            onClick={async () => {
              try {
                const r = await setHook({ data: { baseUrl } });
                toast.success(`Webhook set: ${r.url}`);
                hook.refetch();
              } catch (e: any) {
                toast.error(e?.message ?? "Failed to set webhook");
              }
            }}
          >
            Register webhook
          </Button>
          <Button variant="outline" onClick={() => hook.refetch()}>Refresh info</Button>
        </div>
        <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-64">
          {hook.isLoading ? "Loading..." : JSON.stringify(hook.data ?? hook.error, null, 2)}
        </pre>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          {(["all", "pending", "matched", "unmatched", "ignored"] as const).map((s) => (
            <Button key={s} variant={statusFilter === s ? "default" : "outline"} size="sm" onClick={() => setStatusFilter(s)}>
              {s}
            </Button>
          ))}
          <Button variant="ghost" size="sm" onClick={() => ingest.refetch()}>Refresh</Button>
        </div>

        {ingest.isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
        {ingest.error && <p className="text-sm text-destructive">{(ingest.error as Error).message}</p>}

        <div className="space-y-2">
          {(ingest.data ?? []).map((row) => (
            <div key={row.id} className="rounded-lg border border-border p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">{row.parsed_title ?? row.file_name ?? "(no title)"}</span>
                    <Badge variant="secondary">{row.match_status}</Badge>
                    {row.parsed_year && <Badge variant="outline">{row.parsed_year}</Badge>}
                    {row.parsed_season != null && (
                      <Badge variant="outline">
                        S{String(row.parsed_season).padStart(2, "0")}
                        {row.parsed_episode != null ? `E${String(row.parsed_episode).padStart(2, "0")}` : ""}
                      </Badge>
                    )}
                    {row.parsed_resolution && <Badge variant="outline">{row.parsed_resolution}</Badge>}
                    {row.parsed_quality && <Badge variant="outline">{row.parsed_quality}</Badge>}
                    {row.parsed_codec && <Badge variant="outline">{row.parsed_codec}</Badge>}
                    {row.parsed_language && <Badge variant="outline">{row.parsed_language}</Badge>}
                    {row.match_score != null && (
                      <span className="text-xs text-muted-foreground">score {Number(row.match_score).toFixed(2)}</span>
                    )}
                  </div>
                  {row.caption && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{row.caption}</p>}
                  <p className="text-xs text-muted-foreground mt-1">
                    ch {row.telegram_channel_id} · msg {row.telegram_message_id}
                    {row.file_size ? ` · ${(row.file_size / 1024 / 1024).toFixed(1)} MB` : ""}
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  {row.matched_title_id && row.match_status !== "matched" && (
                    <Button
                      size="sm"
                      onClick={async () => {
                        try {
                          await promote({ data: { ingestId: row.id, titleId: row.matched_title_id! } });
                          toast.success("Promoted");
                          router.invalidate();
                          ingest.refetch();
                        } catch (e: any) {
                          toast.error(e?.message ?? "Failed");
                        }
                      }}
                    >
                      Promote
                    </Button>
                  )}
                  {row.match_status !== "ignored" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        try {
                          await ignore({ data: { ingestId: row.id } });
                          toast.success("Ignored");
                          ingest.refetch();
                        } catch (e: any) {
                          toast.error(e?.message ?? "Failed");
                        }
                      }}
                    >
                      Ignore
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
          {ingest.data && ingest.data.length === 0 && (
            <p className="text-sm text-muted-foreground">No ingest rows for this filter.</p>
          )}
        </div>
      </section>
    </div>
  );
}
