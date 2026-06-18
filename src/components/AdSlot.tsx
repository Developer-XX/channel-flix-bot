import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { listActiveAds, type Ad, type AdPlacement } from "@/lib/ads.functions";
import { getMyPremiumStatus } from "@/lib/premium.functions";

function useIsPremium(): boolean {
  const fn = useServerFn(getMyPremiumStatus);
  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setAuthed(!!data.session);
    });
    return () => { cancelled = true; };
  }, []);
  const q = useQuery({
    queryKey: ["my-premium-ad-gate"],
    queryFn: () => fn(),
    enabled: authed === true,
    staleTime: 60_000,
    retry: false,
  });
  return !!q.data?.isPremium;
}

export function AdSlot({
  placement,
  className = "",
}: {
  placement: AdPlacement;
  className?: string;
}) {
  const isPremium = useIsPremium();
  const listFn = useServerFn(listActiveAds);
  const q = useQuery({
    queryKey: ["ads", placement],
    queryFn: () => listFn({ data: { placement } }),
    staleTime: 5 * 60_000,
    retry: false,
    enabled: !isPremium,
  });

  if (isPremium) return null;
  const ads = (q.data?.ads ?? []) as Ad[];
  if (!ads.length) return null;

  // Pick a single ad per render (rotate by Math.random for fairness).
  const ad = ads[Math.floor(Math.random() * ads.length)];

  return (
    <div className={`relative w-full ${className}`}>
      <span className="absolute top-1 right-2 text-[9px] uppercase tracking-wider text-muted-foreground/60 bg-background/40 rounded px-1">
        Ad
      </span>
      <AdContent ad={ad} />
    </div>
  );
}

function AdContent({ ad }: { ad: Ad }) {
  const inner = (() => {
    if (ad.kind === "video" && ad.video_url) {
      return (
        <video
          src={ad.video_url}
          autoPlay
          muted
          loop
          playsInline
          className="w-full rounded-lg max-h-[360px] object-cover"
        />
      );
    }
    if (ad.kind === "html" && ad.html) {
      // Sandbox untrusted ad HTML in an iframe — never inject directly.
      return (
        <iframe
          title={ad.name}
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          srcDoc={ad.html}
          className="w-full h-[120px] sm:h-[160px] rounded-lg border-0 bg-transparent"
        />
      );
    }
    if (ad.image_url) {
      return (
        <img
          src={ad.image_url}
          alt={ad.name}
          className="w-full rounded-lg max-h-[280px] object-cover"
          loading="lazy"
        />
      );
    }
    return null;
  })();

  if (!inner) return null;
  if (ad.link_url) {
    return (
      <a href={ad.link_url} target="_blank" rel="noopener noreferrer sponsored" className="block">
        {inner}
      </a>
    );
  }
  return inner;
}
