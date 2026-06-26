import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Send } from "lucide-react";
import type { DownloadPreflightConfig } from "@/lib/support-group.functions";
import { openTelegramLink } from "@/lib/telegram-link";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: DownloadPreflightConfig | null;
  onContinue: () => void;
}

function youtubeEmbed(url: string): string | null {
  try {
    const u = new URL(url);
    if (/youtu\.be$/i.test(u.hostname)) {
      const id = u.pathname.replace(/^\/+/, "");
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (/youtube\.com$/i.test(u.hostname.replace(/^www\./, ""))) {
      const id = u.searchParams.get("v");
      if (id) return `https://www.youtube.com/embed/${id}`;
      const m = u.pathname.match(/\/embed\/([^/?#]+)/);
      if (m) return `https://www.youtube.com/embed/${m[1]}`;
    }
    return null;
  } catch {
    return null;
  }
}

export function DownloadPreflightDialog({ open, onOpenChange, config, onContinue }: Props) {
  if (!config) return null;
  const { tutorial, rotationHours, supportGroup } = config;
  const yt = tutorial.enabled && tutorial.type === "youtube" && tutorial.url
    ? youtubeEmbed(tutorial.url)
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tutorial.title}</DialogTitle>
        </DialogHeader>

        {tutorial.description && (
          <p className="text-sm text-muted-foreground">{tutorial.description}</p>
        )}

        {tutorial.enabled && tutorial.url && (
          <div className="aspect-video w-full overflow-hidden rounded-lg border border-border bg-black">
            {yt ? (
              <iframe
                src={yt}
                title="How to download"
                className="h-full w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            ) : (
              <video src={tutorial.url} controls playsInline className="h-full w-full" />
            )}
          </div>
        )}

        {/* Highlighted rotation-hours notice */}
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm">
          <span className="font-semibold text-amber-300">
            Verify once — then download any file free for the next {rotationHours} hour
            {rotationHours === 1 ? "" : "s"}.
          </span>{" "}
          <span className="text-amber-100/80">
            One verification unlocks unlimited downloads during this window.
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
          <Button
            onClick={() => { onOpenChange(false); onContinue(); }}
            className="h-11 bg-gradient-primary text-primary-foreground border-0 hover:opacity-90"
          >
            <ShieldCheck className="h-4 w-4 mr-1.5" />
            Continue to verification
          </Button>
          {supportGroup.enabled && supportGroup.url ? (
            <Button
              variant="outline"
              onClick={() => openTelegramLink(supportGroup.url!)}
              className="h-11 border-[#229ED9]/50 text-[#229ED9] hover:bg-[#229ED9]/10"
            >
              <Send className="h-4 w-4 mr-1.5" />
              Join Help & Support Group
            </Button>
          ) : (
            <Button variant="outline" disabled className="h-11">
              <Send className="h-4 w-4 mr-1.5" /> Support group unavailable
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
