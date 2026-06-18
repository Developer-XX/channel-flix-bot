import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Shared snapshot of the admin "public browsing" toggle. Falls back to true
// (public browsing allowed) on any error so the UI doesn't lock users out
// because of a transient RPC failure.
let cached: boolean | null = null;
let inFlight: Promise<void> | null = null;
const listeners = new Set<(v: boolean) => void>();

function load() {
  if (cached !== null || inFlight) return;
  inFlight = (async () => {
    try {
      const { data, error } = await supabase.rpc("is_public_browsing_enabled");
      cached = error ? true : Boolean(data ?? true);
    } catch {
      cached = true;
    } finally {
      listeners.forEach((l) => l(cached!));
      inFlight = null;
    }
  })();
}

export function usePublicBrowsing(): boolean {
  const [v, setV] = useState<boolean>(cached ?? true);
  useEffect(() => {
    load();
    listeners.add(setV);
    if (cached !== null) setV(cached);
    return () => {
      listeners.delete(setV);
    };
  }, []);
  return v;
}

export function getCachedPublicBrowsing(): boolean {
  return cached !== false; // default-allow until known
}
