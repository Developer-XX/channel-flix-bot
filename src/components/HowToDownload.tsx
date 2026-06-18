import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PlayCircle } from "lucide-react";
import { getTutorialConfig } from "@/lib/tutorial.functions";

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

export function HowToDownload() {
  const fn = useServerFn(getTutorialConfig);
  const q = useQuery({
    queryKey: ["tutorial-config"],
    queryFn: () => fn(),
    staleTime: 5 * 60 * 1000,
  });
  const cfg = q.data;
  if (!cfg?.enabled || !cfg.url) return null;

  const ytId = cfg.type === "youtube" ? extractYouTubeId(cfg.url) : null;

  return (
    <section className="mx-auto max-w-7xl px-4 md:px-6 py-10">
      <div className="rounded-2xl border border-border bg-surface/60 backdrop-blur-sm overflow-hidden shadow-lg">
        <div className="px-6 md:px-8 pt-6 pb-4 border-b border-border/60 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-gradient-primary text-primary-foreground shrink-0">
            <PlayCircle className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-xl md:text-2xl font-bold">{cfg.title}</h2>
            {cfg.description && (
              <p className="text-sm text-muted-foreground mt-0.5">{cfg.description}</p>
            )}
          </div>
        </div>
        <div className="p-4 md:p-6">
          <div className="relative w-full overflow-hidden rounded-xl bg-black aspect-video">
            {ytId ? (
              <iframe
                src={`https://www.youtube.com/embed/${ytId}?rel=0&modestbranding=1`}
                title={cfg.title}
                className="absolute inset-0 h-full w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                loading="lazy"
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
        </div>
      </div>
    </section>
  );
}
