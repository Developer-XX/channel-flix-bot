// Deterministic cache layer for homepage + /section/ reads.
//
// Strategy: a small in-process LRU keyed by (cacheVersion, namespace, key).
// `cacheVersion` is the integer stored in telegram_bot_state.cache_version
// and is bumped whenever data that affects ordering changes (index rebuild,
// Telegram webhook ingest, admin edits). When the version bumps, every old
// entry becomes unreachable — i.e. invalidation is global and atomic without
// needing Redis.
//
// We read cacheVersion at most once every CACHE_VERSION_TTL_MS to avoid
// hammering the DB on each request; that bounds the worst-case staleness
// after an invalidation to a few seconds across all environments.

import type { SupabaseClient } from "@supabase/supabase-js";

const CACHE_VERSION_TTL_MS = 3_000;
const MAX_ENTRIES = 200;
const DEFAULT_ENTRY_TTL_MS = 60_000;

type Entry = { value: unknown; expiresAt: number };
const store = new Map<string, Entry>();

let _versionAdmin: SupabaseClient<any, any, any> | null = null;
let _versionValue = 1;
let _versionFetchedAt = 0;

async function adminClient(): Promise<SupabaseClient<any, any, any>> {
  if (_versionAdmin) return _versionAdmin;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  _versionAdmin = supabaseAdmin as unknown as SupabaseClient<any, any, any>;
  return _versionAdmin;
}

export async function getCacheVersion(): Promise<number> {
  const now = Date.now();
  if (now - _versionFetchedAt < CACHE_VERSION_TTL_MS) return _versionValue;
  try {
    const sb = await adminClient();
    const { data } = await sb
      .from("telegram_bot_state")
      .select("cache_version")
      .eq("id", "global")
      .maybeSingle();
    if (data?.cache_version) _versionValue = Number(data.cache_version);
  } catch {
    // keep last known
  }
  _versionFetchedAt = now;
  return _versionValue;
}

export async function bumpCacheVersionNow(): Promise<number> {
  try {
    const sb = await adminClient();
    const { data: cur } = await sb
      .from("telegram_bot_state")
      .select("cache_version")
      .eq("id", "global")
      .maybeSingle();
    const next = (cur?.cache_version ?? 1) + 1;
    await sb
      .from("telegram_bot_state")
      .upsert({ id: "global", cache_version: next }, { onConflict: "id" });
    _versionValue = next;
    _versionFetchedAt = Date.now();
    // Drop in-process entries eagerly so this worker also sees the change.
    store.clear();
    return next;
  } catch (e) {
    console.warn("[cache] bumpCacheVersionNow failed:", (e as Error).message);
    return _versionValue;
  }
}

function gc() {
  if (store.size <= MAX_ENTRIES) return;
  const now = Date.now();
  for (const [k, v] of store) if (v.expiresAt <= now) store.delete(k);
  if (store.size <= MAX_ENTRIES) return;
  // Evict oldest
  const overflow = store.size - MAX_ENTRIES;
  let i = 0;
  for (const k of store.keys()) {
    if (i++ >= overflow) break;
    store.delete(k);
  }
}

export async function cached<T>(
  namespace: string,
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const v = await getCacheVersion();
  const fullKey = `v${v}:${namespace}:${key}`;
  const now = Date.now();
  const hit = store.get(fullKey);
  if (hit && hit.expiresAt > now) return hit.value as T;
  const value = await loader();
  store.set(fullKey, { value, expiresAt: now + (ttlMs || DEFAULT_ENTRY_TTL_MS) });
  gc();
  return value;
}

/** Used in tests / admin to force a fresh read without a version bump. */
export function _resetCacheForTests() {
  store.clear();
  _versionFetchedAt = 0;
}
