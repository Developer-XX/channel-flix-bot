import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PlayCircle } from "lucide-react";
import { getTutorialConfig } from "@/lib/tutorial.functions";

const STORAGE_KEY = "sv:onboarding:seen-v1";

function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1) || null;
    if (u.searchParams.get("v")) return u.searchParams.get("v");
    const m = u.pathname.match(/\/(embed|shorts)\/([^/?#]+)/);
    if (m) return m[2];
    return null;
  } catch {
    return null;
  }
}

export function OnboardingTutorial() {
  const [open, setOpen] = useState(false);
  const fn = useServerFn(getTutorialConfig);
  const q = useQuery({
    queryKey: ["tutorial-config"],
    queryFn: () => fn(),
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!q.data?.enabled || !q.data.url) return;
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setOpen(true);
    } catch { /* private mode */ }
  }, [q.data?.enabled, q.data?.url]);

  function dismiss() {
    try { localStorage.setItem(STORAGE_KEY, String(Date.now())); } catch { /* ignore */ }
    setOpen(false);
  }

  const cfg = q.data;
  if (!cfg?.enabled || !cfg.url) return null;
  const ytId = cfg.type === "youtube" ? extractYouTubeId(cfg.url) : null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) dismiss(); else setOpen(true); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlayCircle className="h-5 w-5 text-primary" />
            Welcome — quick download tutorial
          </DialogTitle>
          <DialogDescription>
            {cfg.description ?? "Watch this short video to learn how to download files from any title page."}
          </DialogDescription>
        </DialogHeader>
        <div className="relative w-full overflow-hidden rounded-lg bg-black aspect-video">
          {ytId ? (
            <iframe
              src={`https://www.youtube.com/embed/${ytId}?rel=0&modestbranding=1`}
              title={cfg.title}
              className="absolute inset-0 h-full w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          ) : (
            <video
              src={cfg.url}
              controls
              playsInline
              preload="metadata"
              className="absolute inset-0 h-full w-full object-contain"
            />
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={dismiss}>Skip</Button>
          <Button onClick={dismiss}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
