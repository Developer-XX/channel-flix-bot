import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { relinkStaleMediaSources } from "@/lib/admin-relink.functions";

export const Route = createFileRoute("/_authenticated/admin/media-relink")({
  component: MediaRelinkPage,
  head: () => ({
    meta: [
      { title: "Relink stale Telegram sources · Admin" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
});

function MediaRelinkPage() {
  const run = useServerFn(relinkStaleMediaSources);
  const [mediaFileId, setMediaFileId] = useState("");
  const [lookback, setLookback] = useState(168);
  const [limit, setLimit] = useState(100);
  const [includeSuperseded, setIncludeSuperseded] = useState(true);
  const [reactivate, setReactivate] = useState(true);

  const mutation = useMutation({
    mutationFn: () =>
      run({
        data: {
          mediaFileId: mediaFileId.trim() || undefined,
          lookbackHours: lookback,
          limit,
          includeSuperseded,
          reactivateOnRelink: reactivate,
        },
      }),
  });

  return (
    <div className="container mx-auto max-w-4xl space-y-6 py-8">
      <header>
        <h1 className="text-2xl font-semibold">Relink stale Telegram sources</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Re-runs the telegram_file_unique_id self-heal for media files that
          recently failed with <code>source_missing</code> or were marked
          <code> superseded_by_resend</code>. Logs each attempt to the server console.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Run relink</CardTitle>
          <CardDescription>Leave the media file id empty to scan recent failures.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="mfid">Media file id (optional)</Label>
            <Input
              id="mfid"
              placeholder="uuid — targets just one row"
              value={mediaFileId}
              onChange={(e) => setMediaFileId(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="lb">Lookback (hours)</Label>
              <Input
                id="lb"
                type="number"
                min={1}
                max={24 * 60}
                value={lookback}
                onChange={(e) => setLookback(Number(e.target.value) || 168)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="lim">Max candidates</Label>
              <Input
                id="lim"
                type="number"
                min={1}
                max={500}
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value) || 100)}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="inc"
              checked={includeSuperseded}
              onCheckedChange={(v) => setIncludeSuperseded(v === true)}
            />
            <Label htmlFor="inc" className="font-normal">
              Include rows marked superseded_by_resend
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="re"
              checked={reactivate}
              onCheckedChange={(v) => setReactivate(v === true)}
            />
            <Label htmlFor="re" className="font-normal">
              Reactivate superseded rows on successful relink
            </Label>
          </div>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Running…" : "Run relink"}
          </Button>
        </CardContent>
      </Card>

      {mutation.error && (
        <Card>
          <CardContent className="text-destructive pt-6 text-sm">
            {(mutation.error as Error).message}
          </CardContent>
        </Card>
      )}

      {mutation.data && (
        <Card>
          <CardHeader>
            <CardTitle>Result</CardTitle>
            <CardDescription>
              Considered {mutation.data.considered} · Relinked {mutation.data.relinked} ·
              Reactivated {mutation.data.reactivated} · Errors {mutation.data.errors}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-[480px] overflow-auto rounded border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="p-2 text-left">Media file</th>
                    <th className="p-2 text-left">From</th>
                    <th className="p-2 text-left">Before unique_id</th>
                    <th className="p-2 text-left">Before msg_id</th>
                    <th className="p-2 text-left">After unique_id</th>
                    <th className="p-2 text-left">After msg_id</th>
                    <th className="p-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {mutation.data.outcomes.map((o) => (
                    <tr key={o.media_file_id} className="border-t">
                      <td className="p-2 font-mono text-xs">{o.media_file_id}</td>
                      <td className="p-2">{o.source}</td>
                      <td className="p-2 font-mono text-xs">{o.before.telegram_file_unique_id ?? "—"}</td>
                      <td className="p-2">{o.before.telegram_message_id ?? "—"}</td>
                      <td className="p-2 font-mono text-xs">{o.after?.telegram_file_unique_id ?? "—"}</td>
                      <td className="p-2">{o.after?.telegram_message_id ?? "—"}</td>
                      <td className="p-2">
                        {o.error
                          ? `error: ${o.error}`
                          : o.relinked
                            ? o.reactivated
                              ? "relinked + reactivated"
                              : "relinked"
                            : "no match"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
