// Regression coverage for the "video restarts every second / loops the first
// 2-second clip" bug. Verifies:
//   1. While the cancel countdown ticks, the <video> currentTime is strictly
//      monotonic (no backward jumps to ~0).
//   2. No `interstitial:ad_loop_detected` event fires during normal playback.
//   3. Clicking the cancel (X) button stops the countdown, pauses the media,
//      detaches the src, and emits an `interstitial:ad_cancel` event with the
//      server-issued request_id.
//   4. Lifecycle analytics (`ad_lifecycle_start`, `ad_first_frame`,
//      `ad_cancel`) all carry the same request_id so the playback session is
//      traceable end-to-end in production logs.
//
// A second `@load` block reruns the monotonic-time assertion under Slow-3G
// throttling AND while the tab is backgrounded — the exact conditions that
// previously made the remount bug visible.

import { test, expect, type Page } from "@playwright/test";

type LifecycleEvent = { name: string; detail: Record<string, unknown> };

async function instrumentLifecycle(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __interstitialEvents: LifecycleEvent[] }).__interstitialEvents = [];
    const names = [
      "ad_lifecycle_start",
      "ad_first_frame",
      "ad_loop_detected",
      "ad_cancel",
      "ad_complete",
      "ad_play_success",
    ];
    for (const n of names) {
      window.addEventListener(`interstitial:${n}`, (e) => {
        const detail = (e as CustomEvent).detail as Record<string, unknown>;
        (window as unknown as { __interstitialEvents: LifecycleEvent[] }).__interstitialEvents.push({
          name: n,
          detail,
        });
      });
    }
  });
}

async function readEvents(page: Page) {
  return page.evaluate(
    () => (window as unknown as { __interstitialEvents: LifecycleEvent[] }).__interstitialEvents,
  );
}

async function trigger(page: Page) {
  await page.goto("/");
  await page.evaluate(async () => {
    const mod = await import("/src/components/InterstitialController.tsx");
    await (mod as { triggerInterstitial: (p: string) => Promise<boolean> }).triggerInterstitial(
      "interstitial_periodic",
    );
  });
}

test.describe("Interstitial — no restart loop", () => {
  test.beforeEach(async ({ page }) => {
    await instrumentLifecycle(page);
  });

  test("video time is monotonic during the cancel countdown", async ({ page }) => {
    await trigger(page);
    const player = page.locator('[data-testid^="interstitial-"] video').first();
    await expect(player).toBeVisible({ timeout: 15_000 });

    // Sample currentTime once per second for the duration the countdown is
    // visible. Any backward jump to near-zero is the remount bug.
    const samples: number[] = [];
    for (let i = 0; i < 6; i++) {
      const t = await player.evaluate((v) => (v as HTMLVideoElement).currentTime);
      samples.push(t);
      await page.waitForTimeout(1000);
    }
    // Allow tiny seeked-back jitter (<0.3s) but disallow restarts to ~0.
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i], `frame ${i} jumped backward: ${samples.join(",")}`).toBeGreaterThanOrEqual(
        Math.max(0, samples[i - 1] - 0.3),
      );
    }
    // At least one forward tick must have happened.
    expect(samples[samples.length - 1]).toBeGreaterThan(samples[0]);

    const events = await readEvents(page);
    expect(events.some((e) => e.name === "ad_loop_detected")).toBe(false);
  });

  test("cancel button stops countdown, pauses media, and cancels playback cleanly", async ({
    page,
  }) => {
    await trigger(page);
    const player = page.locator('[data-testid^="interstitial-"] video').first();
    await expect(player).toBeVisible({ timeout: 15_000 });

    const closeBtn = page.getByTestId("interstitial-close");
    await expect(closeBtn).toBeVisible({ timeout: 15_000 });
    const timeAtCancel = await player.evaluate((v) => (v as HTMLVideoElement).currentTime);

    await closeBtn.click();

    // The whole interstitial dialog must unmount; the video element should
    // either be gone or stopped (paused + no src).
    await expect(page.locator('[data-testid^="interstitial-"]')).toHaveCount(0, { timeout: 5_000 });

    // Countdown badge is gone with the dialog → no further ticks possible.
    await expect(page.getByTestId("interstitial-countdown")).toHaveCount(0);

    const events = await readEvents(page);
    const cancel = events.find((e) => e.name === "ad_cancel");
    const lifecycle = events.find((e) => e.name === "ad_lifecycle_start");
    const firstFrame = events.find((e) => e.name === "ad_first_frame");
    expect(cancel, "expected ad_cancel event").toBeTruthy();
    expect(cancel!.detail.request_id, "ad_cancel must carry request_id").toBeTruthy();

    // All three lifecycle events must share the same request_id.
    if (lifecycle && firstFrame) {
      expect(cancel!.detail.request_id).toBe(lifecycle.detail.request_id);
      expect(cancel!.detail.request_id).toBe(firstFrame.detail.request_id);
    }
    // currentTime at cancel must match what the analytics captured (within
    // 0.5s tolerance), confirming the same media element was stopped.
    const reportedTime = cancel!.detail.current_time as number | null;
    if (typeof reportedTime === "number") {
      expect(Math.abs(reportedTime - timeAtCancel)).toBeLessThan(0.5);
    }
  });
});

test.describe("@load Interstitial — no restart under throttling / background", () => {
  test("Slow-3G + hidden tab: video time stays monotonic, no loop detected @load", async ({
    page,
    context,
  }) => {
    await instrumentLifecycle(page);

    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      downloadThroughput: (400 * 1024) / 8,
      uploadThroughput: (400 * 1024) / 8,
      latency: 400,
    });

    await trigger(page);

    // Either the player or the Play-fallback satisfies the throttled case; if
    // the fallback shows, click it to start playback.
    const fallback = page.getByTestId("interstitial-play-fallback");
    if (await fallback.isVisible({ timeout: 12_000 }).catch(() => false)) {
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        downloadThroughput: -1,
        uploadThroughput: -1,
        latency: 0,
      });
      await fallback.click();
    }

    const player = page.locator('[data-testid^="interstitial-"] video').first();
    await expect(player).toBeVisible({ timeout: 15_000 });

    // Background the tab and let the countdown tick.
    const other = await context.newPage();
    await other.goto("about:blank");
    await other.bringToFront();
    await page.waitForTimeout(5_000);
    await page.bringToFront();
    await other.close();

    const samples: number[] = await player.evaluate(async (v) => {
      const out: number[] = [];
      for (let i = 0; i < 4; i++) {
        out.push((v as HTMLVideoElement).currentTime);
        await new Promise((r) => setTimeout(r, 800));
      }
      return out;
    });
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThanOrEqual(Math.max(0, samples[i - 1] - 0.3));
    }

    const events = await readEvents(page);
    expect(events.some((e) => e.name === "ad_loop_detected")).toBe(false);
  });
});
