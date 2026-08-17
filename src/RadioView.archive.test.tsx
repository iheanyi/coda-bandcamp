import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RadioShow, RadioShowSummary } from "./types";
import { radioServices, renderRadio, show, shows } from "./test/radioViewTestHarness";

describe("Bandcamp Radio archive behavior", () => {
  it("disables playback actions but keeps semantic detail navigation available", async () => {
    let resolveShow!: (value: RadioShow) => void;
    vi.mocked(radioServices.fetchShow).mockReturnValue(
      new Promise((resolve) => {
        resolveShow = resolve;
      }),
    );
    const { onPlay } = renderRadio();

    await screen.findByRole("heading", { name: "Kinrose" });
    fireEvent.click(screen.getByRole("button", { name: "Play latest show" }));

    expect(
      await screen.findByRole("button", { name: "Loading show…" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add to queue" })).toBeDisabled();
    expect(
      screen.getByRole("link", { name: "View tracklist" }),
    ).toHaveAttribute("href", "/radio/shows/979");

    resolveShow(show);
    await waitFor(() => expect(onPlay).toHaveBeenCalled());
  });

  it("routes every Radio series label to its in-Coda episode archive", async () => {
    renderRadio();

    await screen.findByRole("heading", { name: "Kinrose" });
    fireEvent.click(
      screen.getAllByRole("link", {
        name: "Browse The Hip Hop Show episodes",
      })[0],
    );
    await waitFor(() =>
      expect(radioServices.fetchShows).toHaveBeenCalledWith({
        seriesId: 5,
        cursor: undefined,
      }),
    );
  });

  it("renders a native series supplement when Bandcamp omits archive membership", async () => {
    const madlife: RadioShowSummary = {
      ...shows[0],
      id: 981,
      subtitle: "MADLIFE",
      publishedAt: "07 Aug 2026 00:00:00 GMT",
    };
    const seriesAnchor: RadioShowSummary = {
      ...shows[0],
      subtitle: "Series anchor",
    };
    vi.mocked(radioServices.fetchShows).mockImplementation((request) =>
      Promise.resolve({
        results:
          request?.seriesId === 5 ? [madlife, seriesAnchor] : [madlife],
        hasMore: false,
      }),
    );
    renderRadio();

    await screen.findByRole("heading", { name: "MADLIFE" });
    fireEvent.click(
      screen.getAllByRole("link", {
        name: "Browse The Hip Hop Show episodes",
      })[0],
    );

    await screen.findByRole("heading", { name: "Series anchor" });
    expect(
      screen.getByRole("heading", { name: "MADLIFE" }),
    ).toBeInTheDocument();
  });

  it("loads the next bounded Radio page automatically near the scroll edge", async () => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        private readonly callback: IntersectionObserverCallback;
        readonly root = null;
        readonly rootMargin = "420px 0px";
        readonly thresholds = [0];

        constructor(callback: IntersectionObserverCallback) {
          this.callback = callback;
        }

        observe(target: Element) {
          const bounds = target.getBoundingClientRect();
          const entry: IntersectionObserverEntry = {
            boundingClientRect: bounds,
            intersectionRatio: 1,
            intersectionRect: bounds,
            isIntersecting: true,
            rootBounds: null,
            target,
            time: 0,
          };
          this.callback([entry], this);
        }

        disconnect() {}
        unobserve(_target: Element) {}
        takeRecords() {
          return [];
        }
      },
    );
    vi.mocked(radioServices.fetchShows)
      .mockResolvedValueOnce({
        results: shows,
        cursor: "1770336000:901",
        hasMore: true,
      })
      .mockResolvedValueOnce({
        results: [
          {
            ...shows[1],
            id: 977,
            subtitle: "Next page",
          },
        ],
        hasMore: false,
      });
    renderRadio();

    await screen.findByRole("heading", { name: "Kinrose" });
    expect(
      await screen.findByRole("heading", { name: "Next page" }),
    ).toBeInTheDocument();
    expect(radioServices.fetchShows).toHaveBeenLastCalledWith({
      seriesId: undefined,
      cursor: "1770336000:901",
    });
  });

  it("keeps a large accumulated archive DOM bounded while retaining card actions", async () => {
    const originalResizeObserver = globalThis.ResizeObserver;
    class ResizeObserverMock implements ResizeObserver {
      private readonly callback: ResizeObserverCallback;

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }

      disconnect() {}

      observe(target: Element) {
        const bounds = target.getBoundingClientRect();
        const size = {
          blockSize: bounds.height,
          inlineSize: bounds.width,
        };
        const entry: ResizeObserverEntry = {
          borderBoxSize: [size],
          contentBoxSize: [size],
          contentRect: bounds,
          devicePixelContentBoxSize: [size],
          target,
        };
        this.callback([entry], this);
      }

      unobserve() {}
    }
    globalThis.ResizeObserver = ResizeObserverMock;
    const geometry = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function getBoundingClientRect(this: HTMLElement) {
        const isScrollRoot = this.hasAttribute("data-coda-library-scroll");
        const isArchiveGrid = this.hasAttribute("data-responsive-virtual-grid");
        return new DOMRect(
          0,
          isArchiveGrid ? 100 : 0,
          1_000,
          isScrollRoot ? 600 : 20,
        );
      });
    const largeArchive = Array.from({ length: 1_001 }, (_, index) => ({
      ...shows[index === 0 ? 0 : 1],
      id: 10_000 - index,
      subtitle: index === 0 ? "Featured broadcast" : `Archive show ${index}`,
    }));
    vi.mocked(radioServices.fetchShows).mockResolvedValueOnce({
      results: largeArchive,
      hasMore: false,
    });
    try {
      const { onToggleFavorite } = renderRadio();

      await screen.findByRole("heading", { name: "Featured broadcast" });
      const archive = screen.getByRole("list", {
        name: "Bandcamp Radio archive",
      });
      await waitFor(() => {
        const renderedItems = within(archive).getAllByRole("listitem");
        expect(renderedItems.length).toBeGreaterThan(0);
        expect(renderedItems.length).toBeLessThan(30);
      });
      expect(archive).toHaveAttribute("data-virtualized", "true");
      expect(screen.getByText("1,001 broadcasts loaded")).toBeInTheDocument();

      const firstVisibleFavorite = within(archive).getAllByRole("button", {
        name: /Add Archive show \d+ to favorites/,
      })[0];
      expect(firstVisibleFavorite).toBeDefined();
      fireEvent.click(firstVisibleFavorite!);
      expect(onToggleFavorite).toHaveBeenCalledOnce();
    } finally {
      geometry.mockRestore();
      globalThis.ResizeObserver = originalResizeObserver;
    }
  });

  it("favorites a Radio show without loading its signed stream", async () => {
    const { onToggleFavorite } = renderRadio();

    await screen.findByRole("heading", { name: "Kinrose" });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Add Kinrose to favorites",
      }),
    );

    expect(onToggleFavorite).toHaveBeenCalledWith(shows[0]);
    expect(radioServices.fetchShow).not.toHaveBeenCalled();
  });
});
