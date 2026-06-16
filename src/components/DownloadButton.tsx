import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Send, Loader2, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { requestDownload, requestLinkCode, resolveEpisodeFile } from "@/lib/downloads.functions";
import { startVerification } from "@/lib/verification.functions";

interface Props {
  mediaFileId: string;
  fileName?: string | null;
  size?: "sm" | "default";
  variant?: "outline" | "default";
  titleId?: string;
  season?: number | null;
  episode?: number | null;
}

export function DownloadButton({
  mediaFileId,
  fileName,
  size = "sm",
  variant = "outline",
  titleId,
  season,
  episode,
}: Props) {
  const reqDownload = useServerFn(requestDownload);
  const reqCode = useServerFn(requestLinkCode);
  const resolveEp = useServerFn(resolveEpisodeFile);
  const startVerify = useServerFn(startVerification);
  const [loading, setLoading] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [botUsername, setBotUsername] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) {
        toast.error("Please sign in to download.");
        return;
      }

      // Re-resolve the episode file by (title, season, episode) so a stale
      // mediaFileId after a re-promote is corrected automatically.
      let activeFileId = mediaFileId;
      if (titleId && (season != null || episode != null)) {
        try {
          const res = await resolveEp({
            data: { titleId, season: season ?? null, episode: episode ?? null, expectedFileId: mediaFileId },
          });
          if (res.ok) {
            activeFileId = res.file.id;
            if (res.changed) toast.message("Episode file was updated to the latest version.");
          }
        } catch { /* fall back to mediaFileId */ }
      }

      const r = await reqDownload({ data: { mediaFileId: activeFileId } });
      if (r.ok) {
        toast.success(`✅ ${fileName ?? "File"} sent to your Telegram`);
        return;
      }
      if (r.reason === "needs_verification") {
        toast.message("Verification required — opening verification link…");
        const v = await startVerify({ data: { mediaFileId: activeFileId } });
        window.location.href = v.redirectUrl;
        return;
      }
      if (r.reason === "not_linked" || r.reason === "bot_blocked") {
        const codeRes = await reqCode();
        setCode(codeRes.code);
        setBotUsername(codeRes.botUsername);
        setLinkOpen(true);
        return;
      }
      toast.error(`Couldn't deliver: ${r.reason}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Download failed");
    } finally {
      setLoading(false);
    }
  }

  const tgUrl = botUsername && code ? `https://t.me/${botUsername}?start=link_${code}` : null;

  return (
    <>
      <Button size={size} variant={variant} onClick={handleClick} disabled={loading} className="shrink-0">
        {loading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Send className="h-4 w-4 mr-1.5" />}
        via Bot
      </Button>

      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link your Telegram to download</DialogTitle>
            <DialogDescription>
              Our bot DMs files to you on Telegram. Open the bot and press Start with the code below, then click Download again.
            </DialogDescription>
          </DialogHeader>
          {code && (
            <div className="space-y-3">
              <div className="rounded-lg border border-border bg-surface/60 p-4 text-center">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Your code</div>
                <div className="font-mono text-3xl font-bold mt-1 tracking-widest">{code}</div>
                <div className="text-xs text-muted-foreground mt-2">Expires in 15 minutes</div>
              </div>
              <div className="flex gap-2">
                {tgUrl && (
                  <Button asChild className="flex-1">
                    <a href={tgUrl} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-4 w-4 mr-1.5" /> Open Bot
                    </a>
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(`/start link_${code}`);
                    toast.success("Command copied");
                  }}
                >
                  <Copy className="h-4 w-4 mr-1.5" /> Copy command
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                After pressing Start in the bot, come back and click Download again.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
