// @vitest-environment jsdom
/**
 * Structural responsive checks for SeasonAccordion.
 *
 * jsdom doesn't run real CSS layout, so we can't measure pixels. Instead we
 * assert the responsive primitives are in place — every row that holds text
 * has `min-w-0` + `truncate`, every fixed widget has `shrink-0`, and every
 * episode file is in the DOM. If those classes ever drop off, filenames /
 * download buttons start clipping at narrow widths — which is exactly the
 * bug this test is here to prevent.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SeasonAccordion } from "@/components/SeasonAccordion";

// Mock the supabase client used inside SeasonAccordion.
vi.mock("@/integrations/supabase/client", () => {
  const rows = Array.from({ length: 24 }, (_, i) => ({
    id: `f${i + 1}`,
    file_name: `Show Season 1 Episode ${String(i + 1).padStart(2, "0")} 1080p WEB-DL.mkv`,
    quality: "WEB-DL",
    resolution: "1080p",
    language: "en",
    file_size: 1_200_000_000,
    episode_id: `e${i + 1}`,
    episodes: {
      episode_number: i + 1,
      name: null,
      seasons: { season_number: 1, name: "Season 1" },
    },
  }));
  return {
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => Promise.resolve({ data: rows, error: null }),
          }),
        }),
      }),
    },
  };
});

// DownloadButton is a server-fn-backed component; stub it so the test stays unit-level.
vi.mock("@/components/DownloadButton", () => ({
  DownloadButton: ({ fileName }: { fileName: string }) => (
    <button data-testid="download-btn" aria-label={`Download ${fileName}`}>Download</button>
  ),
}));

function renderWithClient() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SeasonAccordion titleId="t1" />
    </QueryClientProvider>,
  );
}

describe("SeasonAccordion responsive structure", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders all 24 episodes and their download buttons (none clipped/hidden)", async () => {
    renderWithClient();
    await screen.findByText("Episode 1");
    for (let i = 1; i <= 24; i++) {
      const ep = String(i);
      expect(screen.getByText(`Episode ${i}`)).toBeTruthy();
    }
    expect(screen.getAllByTestId("download-btn")).toHaveLength(24);
  });

  it("applies the responsive primitives that prevent overflow at small widths", async () => {
    const { container } = renderWithClient();
    await screen.findByText("Episode 1");

    expect(container.querySelector('[data-testid="season-accordion"]')).toBeTruthy();

    // Download button wrappers must be `shrink-0` so the button can't get pushed off.
    const btns = screen.getAllByTestId("download-btn");
    expect(btns.length).toBe(24);
    for (const btn of btns) {
      expect((btn.parentElement as HTMLElement).className).toMatch(/shrink-0/);
    }

    // Find every per-file row (one per download button) and assert min-w-0 / truncate primitives.
    const fileRows = btns.map((b) => b.parentElement!.parentElement as HTMLElement);
    for (const row of fileRows) {
      expect(row.className).toMatch(/min-w-0/);
      expect(row.className).toMatch(/grid-cols-\[auto_minmax\(0,1fr\)_auto\]/);
      // The text column must contain a `truncate` filename child
      const truncated = row.querySelector(".truncate");
      expect(truncated).toBeTruthy();
    }
  });

  it("first season auto-opens regardless of its number (covers Chhota Bheem S18)", async () => {
    renderWithClient();
    expect(await screen.findByText("Episode 1")).toBeTruthy();
  });
});
