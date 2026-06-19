// @vitest-environment jsdom
/**
 * Sizing stability, retry flow, autoplay-blocked fallback, timeout watchdog,
 * and analytics emission for VideoInterstitial. jsdom can't run real CSS or
 * media decoding, so we drive playback by stubbing HTMLMediaElement.play and
 * asserting on class wiring + emitted CustomEvents.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";

// Mock useServerFn to return its argument as-is — so when the component
// calls useServerFn(listActiveAds) it receives the vi.fn() we exported below.
vi.mock("@tanstack/react-start", () => ({
  useServerFn: (fn: unknown) => fn,
}));

vi.mock("@/lib/ads.functions", () => ({
  listActiveAds: vi.fn(),
  recordAdEvent: vi.fn(() => Promise.resolve({ ok: true })),
  AD_PLACEMENTS: [
    "homepage_banner",
    "between_rows",
    "title_page",
    "before_download",
    "interstitial_login",
    "interstitial_periodic",
    "interstitial_before_download",
  ],
  INTERSTITIAL_PLACEMENTS: [
    "interstitial_login",
    "interstitial_periodic",
    "interstitial_before_download",
  ],
}));

vi.mock("@/lib/ad-perf.functions", () => ({
  recordAdPerfEvent: vi.fn(() => Promise.resolve({ ok: true })),
}));

import { listActiveAds, recordAdEvent } from "@/lib/ads.functions";
import { recordAdPerfEvent } from "@/lib/ad-perf.functions";

const listFn = listActiveAds as unknown as ReturnType<typeof vi.fn>;
const trackFn = recordAdEvent as unknown as ReturnType<typeof vi.fn>;
const perfFn = recordAdPerfEvent as unknown as ReturnType<typeof vi.fn>;

import { VideoInterstitial } from "@/components/VideoInterstitial";

const VIDEO_AD = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Test Ad",
  placement: "interstitial_login",
  kind: "video" as const,
  image_url: "https://example.com/poster.jpg",
  video_url: "https://example.com/clip.mp4",
  html: null,
  link_url: "https://example.com",
  sort_order: 0,
  is_active: true,
  starts_at: null,
  ends_at: null,
};

function captureEvents(names: string[]) {
  const seen: { name: string; detail: unknown }[] = [];
  const handlers = names.map((n) => {
    const h = (e: Event) => seen.push({ name: n, detail: (e as CustomEvent).detail });
    window.addEventListener(`interstitial:${n}`, h);
    return [n, h] as const;
  });
  return {
    seen,
    cleanup: () => handlers.forEach(([n, h]) => window.removeEventListener(`interstitial:${n}`, h)),
  };
}

beforeEach(() => {
  listFn.mockReset();
  trackFn.mockClear();
  perfFn.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("VideoInterstitial", () => {
  it("renders a fixed-aspect skeleton while loading (no layout shift)", async () => {
    let resolve: (value: { ads: typeof VIDEO_AD[] }) => void = () => {};
    listFn.mockReturnValue(new Promise((r) => (resolve = r)));

    render(<VideoInterstitial placement="interstitial_login" cancelSeconds={5} onClose={() => {}} />);

    const skeleton = await screen.findByTestId("interstitial-skeleton");
    // Aspect classes that keep dialog size stable across loading → ready.
    expect(skeleton.className).toContain("aspect-video");
    expect(skeleton.className).toContain("w-full");

    resolve!({ ads: [VIDEO_AD] });
    await waitFor(() => expect(screen.getByTestId(/^interstitial-/)).toBeTruthy());
  });

  it("emits load_start + load_success and records server impression", async () => {
    listFn.mockResolvedValue({ ads: [VIDEO_AD] });
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve()) as unknown as () => Promise<void>;

    const cap = captureEvents(["ad_load_start", "ad_load_success", "ad_play_success"]);

    render(<VideoInterstitial placement="interstitial_login" cancelSeconds={5} onClose={() => {}} />);

    await waitFor(() => expect(cap.seen.some((e) => e.name === "ad_load_success")).toBe(true));
    expect(cap.seen.some((e) => e.name === "ad_load_start")).toBe(true);

    // canPlay handler triggers tryPlay → records "view"
    const video = document.querySelector("video")!;
    fireEvent.canPlay(video);
    await waitFor(() => expect(cap.seen.some((e) => e.name === "ad_play_success")).toBe(true));

    expect(trackFn).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ event_type: "impression", ad_id: VIDEO_AD.id }),
      }),
    );
    expect(trackFn).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ event_type: "view", ad_id: VIDEO_AD.id }),
      }),
    );

    cap.cleanup();
  });

  it("renders the Play video fallback when autoplay is blocked and recovers on tap", async () => {
    listFn.mockResolvedValue({ ads: [VIDEO_AD] });
    let firstCall = true;
    HTMLMediaElement.prototype.play = vi.fn(() => {
      if (firstCall) {
        firstCall = false;
        return Promise.reject(new DOMException("NotAllowedError", "NotAllowedError"));
      }
      return Promise.resolve();
    }) as unknown as () => Promise<void>;

    const cap = captureEvents(["ad_autoplay_blocked", "ad_play_success"]);

    render(<VideoInterstitial placement="interstitial_login" cancelSeconds={5} onClose={() => {}} />);

    const video = await waitFor(() => document.querySelector("video")!);
    fireEvent.canPlay(video);

    const fallback = await screen.findByTestId("interstitial-play-fallback");
    expect(fallback.textContent ?? "").toMatch(/Play video/i);
    expect(cap.seen.some((e) => e.name === "ad_autoplay_blocked")).toBe(true);
    expect(perfFn).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ metric: "autoplay_blocked" }),
      }),
    );

    // User taps "Play video" → playWithSound succeeds on second call.
    fireEvent.click(fallback);
    await waitFor(() => expect(cap.seen.some((e) => e.name === "ad_play_success")).toBe(true));

    cap.cleanup();
  });

  it("fires the timeout watchdog when first frame never lands", async () => {
    vi.useFakeTimers();
    listFn.mockResolvedValue({ ads: [VIDEO_AD] });
    HTMLMediaElement.prototype.play = vi.fn(() => new Promise(() => {})) as unknown as () => Promise<void>;

    const cap = captureEvents(["ad_timeout"]);
    render(<VideoInterstitial placement="interstitial_login" cancelSeconds={5} onClose={() => {}} />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(8500);
    });

    expect(cap.seen.some((e) => e.name === "ad_timeout")).toBe(true);
    cap.cleanup();
  });

  it("renders the error card with a working Retry button", async () => {
    listFn.mockRejectedValueOnce(new Error("network down"));
    render(<VideoInterstitial placement="interstitial_login" cancelSeconds={5} onClose={() => {}} />);

    const err = await screen.findByTestId("interstitial-error");
    expect(err.className).toContain("aspect-video"); // no layout shift vs skeleton
    expect(err.textContent ?? "").toMatch(/network down/);

    // Next call succeeds; clicking Retry reloads the ad.
    listFn.mockResolvedValueOnce({ ads: [VIDEO_AD] });
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve()) as unknown as () => Promise<void>;

    fireEvent.click(screen.getByTestId("interstitial-retry"));
    await waitFor(() => expect(document.querySelector("video")).toBeTruthy());
    expect(listFn).toHaveBeenCalledTimes(2);
  });

  it("emits mute/unmute events when the toggle is used", async () => {
    listFn.mockResolvedValue({ ads: [VIDEO_AD] });
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve()) as unknown as () => Promise<void>;

    const cap = captureEvents(["ad_mute", "ad_unmute"]);
    render(<VideoInterstitial placement="interstitial_login" cancelSeconds={5} onClose={() => {}} />);
    const video = await waitFor(() => document.querySelector("video")!);
    fireEvent.canPlay(video);

    const toggle = await screen.findByTestId("interstitial-mute");
    fireEvent.click(toggle); // muted → unmuted
    await waitFor(() => expect(cap.seen.some((e) => e.name === "ad_unmute")).toBe(true));
    fireEvent.click(toggle); // unmuted → muted
    await waitFor(() => expect(cap.seen.some((e) => e.name === "ad_mute")).toBe(true));

    cap.cleanup();
  });
});
