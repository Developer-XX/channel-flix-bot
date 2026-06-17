// Server-only runtime settings reader.
// Reads from public.app_settings (admin-editable) and falls back to process.env.
// 60s in-memory cache; bumped on any write via bumpSettingsVersion().

type Cache = { at: number; values: Map<string, string | null> };
let cache: Cache | null = null;
const TTL_MS = 60_000;

export function bumpSettingsVersion() {
  cache = null;
}

async function loadAll(): Promise<Map<string, string | null>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.values;
  const values = new Map<string, string | null>();
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.from("app_settings").select("key, value");
    for (const row of (data ?? []) as Array<{ key: string; value: string | null }>) {
      values.set(row.key, row.value);
    }
  } catch (e) {
    console.warn("[runtime-settings] load failed:", (e as Error).message);
  }
  cache = { at: Date.now(), values };
  return values;
}

export async function getSetting(key: string): Promise<string | null> {
  const all = await loadAll();
  const v = all.get(key);
  if (v != null && v !== "") return v;
  const env = process.env[key];
  return env && env !== "" ? env : null;
}

export async function getSettingNumber(key: string, fallback: number): Promise<number> {
  const v = await getSetting(key);
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
