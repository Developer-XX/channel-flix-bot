import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Lightweight shared auth-state snapshot so dozens of TitleCards don't each
// open a Supabase listener. Reads session once from localStorage, then keeps
// in sync via a single onAuthStateChange subscription.
let cached: boolean | null = null;
const listeners = new Set<(v: boolean) => void>();
let initialized = false;

function init() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  supabase.auth.getSession().then(({ data }) => {
    cached = !!data.session;
    listeners.forEach((l) => l(cached!));
  });
  supabase.auth.onAuthStateChange((_e, session) => {
    cached = !!session;
    listeners.forEach((l) => l(cached!));
  });
}

export function useIsAuthed(): boolean {
  const [v, setV] = useState<boolean>(cached ?? false);
  useEffect(() => {
    init();
    listeners.add(setV);
    if (cached !== null) setV(cached);
    return () => {
      listeners.delete(setV);
    };
  }, []);
  return v;
}

export function getCachedAuthed(): boolean {
  return cached === true;
}
