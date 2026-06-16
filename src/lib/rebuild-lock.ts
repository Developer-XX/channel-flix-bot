// Pure orchestration for the maybe-rebuild-indexes cron hook. All Supabase
// access is injected so the locking + skip-reason logic can be unit-tested.

export type RebuildResult =
  | { ok: true; skipped: "no_pending" | "overlap" }
  | { ok: true; rebuilt: unknown }
  | { ok: false; error: string };

export interface RebuildDeps {
  getPending(): Promise<boolean>;
  insertInflight(startedAt: string): Promise<{ id: string } | { error: string }>;
  insertSkipped(startedAt: string, reason: "no_pending" | "overlap"): Promise<void>;
  runRebuild(): Promise<unknown>;
  finishRun(runId: string, finishedAt: string, result: unknown): Promise<void>;
  failRun(runId: string, finishedAt: string, error: string): Promise<void>;
  markRebuilt(): Promise<void>;
  now(): string;
}

export async function maybeRebuild(deps: RebuildDeps): Promise<RebuildResult> {
  const startedAt = deps.now();
  const pending = await deps.getPending();
  if (!pending) {
    await deps.insertSkipped(startedAt, "no_pending");
    return { ok: true, skipped: "no_pending" };
  }
  const ins = await deps.insertInflight(startedAt);
  if ("error" in ins) {
    await deps.insertSkipped(startedAt, "overlap");
    return { ok: true, skipped: "overlap" };
  }
  try {
    const r = await deps.runRebuild();
    await deps.markRebuilt();
    await deps.finishRun(ins.id, deps.now(), r);
    return { ok: true, rebuilt: r };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await deps.failRun(ins.id, deps.now(), msg.slice(0, 500));
    return { ok: false, error: msg };
  }
}
