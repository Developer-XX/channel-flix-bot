import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { X, Megaphone, ExternalLink } from "lucide-react";
import { listActiveAnnouncements } from "@/lib/announcements.functions";

const DISMISS_KEY = "sv:announcements:dismissed-v1";

function loadDismissed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch { return new Set(); }
}

function saveDismissed(set: Set<string>) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(DISMISS_KEY, JSON.stringify(Array.from(set))); } catch { /* ignore */ }
}

const variantClass = {
  info:    "bg-primary/10 text-foreground border-b border-primary/30",
  success: "bg-emerald-500/10 text-foreground border-b border-emerald-500/30",
  warning: "bg-amber-500/10 text-foreground border-b border-amber-500/30",
  promo:   "bg-gradient-to-r from-fuchsia-500/15 to-primary/15 text-foreground border-b border-fuchsia-500/30",
} as const;

export function AnnouncementBar() {
  const list = useServerFn(listActiveAnnouncements);
  const q = useQuery({
    queryKey: ["announcements-active"],
    queryFn: () => list(),
    refetchInterval: 5 * 60_000,
    retry: false,
  });
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  useEffect(() => { setDismissed(loadDismissed()); }, []);

  const items = (q.data ?? []).filter((a) => !dismissed.has(a.id));
  if (items.length === 0) return null;
  const a = items[0];

  return (
    <div className={`relative z-[60] ${variantClass[a.variant]}`}>
      <div className="mx-auto flex max-w-7xl items-center gap-2 px-3 sm:px-4 py-1.5 text-xs sm:text-sm">
        <Megaphone className="h-3.5 w-3.5 shrink-0 opacity-80" />
        <div className="flex-1 truncate">
          <span>{a.body}</span>
          {a.link_url && (
            <a href={a.link_url} className="ml-2 inline-flex items-center gap-1 underline" target="_blank" rel="noreferrer">
              Learn more <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
        <button
          aria-label="Dismiss"
          className="opacity-70 hover:opacity-100"
          onClick={() => {
            const next = new Set(dismissed);
            next.add(a.id);
            setDismissed(next);
            saveDismissed(next);
          }}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
