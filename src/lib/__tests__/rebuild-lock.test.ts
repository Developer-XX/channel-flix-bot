import { describe, it, expect, vi } from "vitest";
import { maybeRebuild, type RebuildDeps } from "@/lib/rebuild-lock";

function makeDeps(over: Partial<RebuildDeps> = {}): RebuildDeps {
  return {
    getPending: vi.fn(async () => true),
    insertInflight: vi.fn(async () => ({ id: "run-1" })),
    insertSkipped: vi.fn(async () => {}),
    runRebuild: vi.fn(async () => ({ rebuilt: true })),
    finishRun: vi.fn(async () => {}),
    failRun: vi.fn(async () => {}),
    markRebuilt: vi.fn(async () => {}),
    now: vi.fn(() => "2026-06-16T00:00:00.000Z"),
    ...over,
  };
}

describe("maybeRebuild advisory locking", () => {
  it("skips with no_pending when nothing is queued and never runs rebuild", async () => {
    const deps = makeDeps({ getPending: vi.fn(async () => false) });
    const r = await maybeRebuild(deps);
    expect(r).toEqual({ ok: true, skipped: "no_pending" });
    expect(deps.runRebuild).not.toHaveBeenCalled();
    expect(deps.insertSkipped).toHaveBeenCalledWith(
      "2026-06-16T00:00:00.000Z",
      "no_pending",
    );
  });

  it("skips with overlap when insert-inflight fails (lock held by another run)", async () => {
    const deps = makeDeps({
      insertInflight: vi.fn(async () => ({ error: "unique violation" })),
    });
    const r = await maybeRebuild(deps);
    expect(r).toEqual({ ok: true, skipped: "overlap" });
    expect(deps.runRebuild).not.toHaveBeenCalled();
    expect(deps.insertSkipped).toHaveBeenCalledWith(
      "2026-06-16T00:00:00.000Z",
      "overlap",
    );
  });

  it("acquires lock, rebuilds, then marks the run finished", async () => {
    const deps = makeDeps();
    const r = await maybeRebuild(deps);
    expect(r.ok).toBe(true);
    expect(deps.runRebuild).toHaveBeenCalledOnce();
    expect(deps.markRebuilt).toHaveBeenCalledOnce();
    expect(deps.finishRun).toHaveBeenCalledOnce();
    expect(deps.failRun).not.toHaveBeenCalled();
  });

  it("records failure on the existing run row when rebuild throws (no orphan lock)", async () => {
    const deps = makeDeps({
      runRebuild: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    const r = await maybeRebuild(deps);
    expect(r.ok).toBe(false);
    expect(deps.failRun).toHaveBeenCalledOnce();
    expect(deps.finishRun).not.toHaveBeenCalled();
    expect(deps.markRebuilt).not.toHaveBeenCalled();
  });

  it("only one of two concurrent invocations actually runs the rebuild", async () => {
    // Simulate a real race: insertInflight succeeds for caller A and fails
    // (unique partial index violation) for caller B.
    let held = false;
    const shared: Partial<RebuildDeps> = {
      insertInflight: vi.fn(async () => {
        if (held) return { error: "duplicate key" };
        held = true;
        return { id: "run-A" };
      }),
      runRebuild: vi.fn(async () => {
        // simulate work
        await new Promise((res) => setTimeout(res, 10));
        return { rebuilt: true };
      }),
    };
    const depsA = makeDeps(shared);
    const depsB = makeDeps(shared);
    const [a, b] = await Promise.all([maybeRebuild(depsA), maybeRebuild(depsB)]);
    const skipped = [a, b].filter((x) => "skipped" in x && x.skipped === "overlap");
    const ran = [a, b].filter((x) => "rebuilt" in x);
    expect(skipped).toHaveLength(1);
    expect(ran).toHaveLength(1);
  });
});
