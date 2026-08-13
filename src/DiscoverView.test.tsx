import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterContextProvider } from "@tanstack/react-router";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCodaMemoryRouter } from "@/router";
import type { DiscoverFilters, Track } from "@/types";

const mocks = vi.hoisted(() => ({
  fetchDiscover: vi.fn(),
  openBandcampUrl: vi.fn(),
}));

vi.mock("@/lib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib")>();
  return {
    ...actual,
    fetchDiscover: mocks.fetchDiscover,
    openBandcampUrl: mocks.openBandcampUrl,
  };
});

import DiscoverView, { DiscoverScreen } from "./DiscoverView";

function renderDiscover(
  onQueue = vi.fn(),
  playback: {
    currentTrackId?: string;
    playing?: boolean;
    onPlay?: (track: Track) => void;
    onTogglePlayback?: () => void;
    onOpenRelease?: () => void;
    onOpenArtist?: () => void;
  } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createCodaMemoryRouter(client, [
    "/discover?tag=&sort=top",
  ]);
  const onTogglePlayback = playback.onTogglePlayback ?? vi.fn();
  const onPlay = playback.onPlay ?? vi.fn();
  return {
    client,
    onPlay,
    onTogglePlayback,
    router,
    ...render(
      <QueryClientProvider client={client}>
        <RouterContextProvider router={router}>
          <div data-coda-library-scroll>
            <DiscoverView
              onPlay={onPlay}
              onQueue={onQueue}
              currentTrackId={playback.currentTrackId}
              playing={playback.playing ?? false}
              onTogglePlayback={onTogglePlayback}
              onOpenRelease={playback.onOpenRelease ?? vi.fn()}
              onOpenArtist={playback.onOpenArtist ?? vi.fn()}
            />
          </div>
        </RouterContextProvider>
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  mocks.openBandcampUrl.mockReset();
  mocks.fetchDiscover.mockReset().mockResolvedValue({
    results: [
      {
        id: "discover:release-1",
        title: "Blue Hours",
        artist: "Signal Garden",
        location: "Chicago, Illinois",
        itemUrl: "https://signal-garden.bandcamp.com/album/blue-hours",
        featuredTrack: {
          id: "preview-1",
          title: "Glass Lines",
          duration: 201,
          streamUrl: "https://t4.bcbits.com/stream/example",
        },
      },
    ],
    resultCount: 1,
    hasMore: false,
  });
});

describe("Discover", () => {
  it("keeps committed route filters controlled while synchronizing the local draft", async () => {
    const user = userEvent.setup();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const router = createCodaMemoryRouter(client, [
      "/discover?tag=&sort=top",
    ]);
    const onFiltersChange = vi.fn();
    const renderScreen = (filters: DiscoverFilters) => (
      <QueryClientProvider client={client}>
        <RouterContextProvider router={router}>
          <div data-coda-library-scroll>
            <DiscoverScreen
              filters={filters}
              onFiltersChange={onFiltersChange}
              onPlay={vi.fn()}
              onQueue={vi.fn()}
              playing={false}
              onTogglePlayback={vi.fn()}
              onOpenRelease={vi.fn()}
              onOpenArtist={vi.fn()}
            />
          </div>
        </RouterContextProvider>
      </QueryClientProvider>
    );
    const view = render(renderScreen({ tag: "", sort: "top" }));

    await screen.findByText("Blue Hours");
    const sort = screen.getByRole("combobox", {
      name: "Sort Discover results",
    });
    await user.click(sort);
    await user.click(await screen.findByRole("option", {
      name: "New arrivals",
    }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({ tag: "", sort: "new" });
    expect(sort).toHaveTextContent("Best-selling");

    view.rerender(renderScreen({ tag: "", sort: "new" }));
    expect(sort).toHaveTextContent("New arrivals");

    await user.click(screen.getByRole("button", { name: "Jazz" }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      tag: "jazz",
      sort: "new",
    });
    expect(screen.getByRole("button", { name: "All genres" }))
      .toHaveAttribute("aria-pressed", "true");

    view.rerender(renderScreen({ tag: "rock", sort: "new" }));
    const input = screen.getByRole("textbox", {
      name: "Search Discover by tag",
    });
    await waitFor(() => expect(input).toHaveValue("rock"));
    await user.clear(input);
    await user.type(input, "  shoegaze  ");
    await user.click(screen.getByRole("button", { name: "Explore" }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      tag: "shoegaze",
      sort: "new",
    });
  });

  it("disables Discover controls while the initiating request is pending", async () => {
    let resolveDiscover!: (value: {
      results: [];
      resultCount: number;
      hasMore: boolean;
    }) => void;
    mocks.fetchDiscover.mockReturnValue(new Promise((resolve) => {
      resolveDiscover = resolve;
    }));
    renderDiscover();

    expect(
      await screen.findByRole("button", { name: "Exploring…" }),
    ).toBeDisabled();
    const pendingSurface = screen.getByText("Scanning Bandcamp…").parentElement;
    expect(
      pendingSurface?.querySelectorAll('[data-slot="spinner"]'),
    ).toHaveLength(1);
    expect(
      pendingSurface?.querySelector('[data-slot="skeleton"]'),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All genres" })).toBeDisabled();
    expect(screen.getByRole("combobox", {
      name: "Sort Discover results",
    })).toBeDisabled();

    resolveDiscover({ results: [], resultCount: 0, hasMore: false });
    expect(await screen.findByText("No releases found")).toBeInTheDocument();
  });

  it("reveals a card-level queue action without durations and supports the full genre selector", async () => {
    const user = userEvent.setup();
    const onQueue = vi.fn();
    renderDiscover(onQueue);

    const releaseTitle = await screen.findByText("Blue Hours");
    const releaseCard = releaseTitle.closest("article");
    if (!releaseCard) throw new Error("Expected Discover release card");
    expect(within(releaseCard).queryByText("3:21")).not.toBeInTheDocument();
    const queueButton = within(releaseCard).getByRole("button", {
      name: "Add Glass Lines to queue",
    });
    expect(queueButton).toHaveAttribute("data-coda-discover-queue-action");
    expect(queueButton).toHaveAttribute("title", "Add to queue");
    expect(
      queueButton.closest('[data-slot="card-action-overlay"]'),
    ).toBeInTheDocument();
    expect(queueButton.querySelector(".lucide-plus")).toBeInTheDocument();
    expect(queueButton).toHaveAttribute("data-confirmed", "false");
    await user.click(queueButton);
    expect(onQueue).toHaveBeenCalledTimes(1);
    expect(queueButton).toHaveAccessibleName("Glass Lines added to queue");
    expect(queueButton).toHaveAttribute("title", "Added");
    expect(queueButton).toHaveAttribute("data-confirmed", "true");
    expect(queueButton.querySelector(".lucide-check")).toBeInTheDocument();

    const genreNavigation = screen.getByRole("navigation", {
      name: "Filter Discover by genre",
    });

    await user.click(within(genreNavigation).getByRole("button", {
      name: "Jazz",
    }));
    await waitFor(() =>
      expect(mocks.fetchDiscover).toHaveBeenLastCalledWith(
        expect.objectContaining({ tag: "jazz" }),
        "*",
      ),
    );
  });

  it("keeps card fallback artwork until a replacement URL loads", async () => {
    const firstArtworkUrl = "https://f4.bcbits.com/img/blue-hours-broken.jpg";
    const nextArtworkUrl = "https://f4.bcbits.com/img/blue-hours-fixed.jpg";
    mocks.fetchDiscover.mockImplementation(async ({ tag }) => ({
      results: [
        {
          id: "discover:release-1",
          title: "Blue Hours",
          artist: "Signal Garden",
          itemUrl: "https://signal-garden.bandcamp.com/album/blue-hours",
          artworkUrl: tag ? nextArtworkUrl : firstArtworkUrl,
        },
      ],
      resultCount: 1,
      hasMore: false,
    }));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const router = createCodaMemoryRouter(client, [
      "/discover?tag=&sort=top",
    ]);
    const screenFor = (filters: DiscoverFilters) => (
      <QueryClientProvider client={client}>
        <RouterContextProvider router={router}>
          <div data-coda-library-scroll>
            <DiscoverScreen
              filters={filters}
              onFiltersChange={vi.fn()}
              onPlay={vi.fn()}
              onQueue={vi.fn()}
              playing={false}
              onTogglePlayback={vi.fn()}
              onOpenRelease={vi.fn()}
              onOpenArtist={vi.fn()}
            />
          </div>
        </RouterContextProvider>
      </QueryClientProvider>
    );
    const view = render(screenFor({ tag: "", sort: "top" }));

    await screen.findByText("Blue Hours");
    let artwork = view.container.querySelector(
      "[data-coda-discover-artwork]",
    );
    const failedImage = artwork?.querySelector("img");
    expect(failedImage).toHaveAttribute("src", firstArtworkUrl);
    if (!failedImage) throw new Error("Expected initial Discover artwork.");
    fireEvent.error(failedImage);
    expect(artwork?.querySelector("img")).not.toBeInTheDocument();
    expect(
      artwork?.querySelector("[data-discover-artwork-fallback]"),
    ).toHaveTextContent("BH");

    view.rerender(screenFor({ tag: "rock", sort: "top" }));
    await waitFor(() => {
      artwork = view.container.querySelector("[data-coda-discover-artwork]");
      expect(artwork?.querySelector("img")).toHaveAttribute(
        "src",
        nextArtworkUrl,
      );
    });
    const refreshedImage = artwork?.querySelector("img");
    expect(refreshedImage).toHaveClass("invisible");
    expect(
      artwork?.querySelector("[data-discover-artwork-fallback]"),
    ).toHaveTextContent("BH");
    if (!refreshedImage) throw new Error("Expected replacement artwork.");

    fireEvent.load(refreshedImage);
    expect(refreshedImage).not.toHaveClass("invisible");
    expect(
      artwork?.querySelector("[data-discover-artwork-fallback]"),
    ).not.toBeInTheDocument();
    expect(artwork).toHaveAttribute(
      "data-coda-discover-artwork",
      "discover:release-1",
    );
  });

  it("uses the Collection-style genre rail and sort menu", async () => {
    renderDiscover();

    await screen.findByText("Blue Hours");
    const genres = screen.getByRole("navigation", {
      name: "Filter Discover by genre",
    });
    expect(genres).toHaveClass("overflow-x-auto");
    expect(screen.queryByRole("combobox", {
      name: "More Discover genres",
    })).not.toBeInTheDocument();

    Object.defineProperties(genres, {
      clientWidth: { configurable: true, value: 240 },
      scrollWidth: { configurable: true, value: 720 },
    });
    fireEvent(window, new Event("resize"));
    expect(screen.getByRole("button", {
      name: "Show more genres",
    })).toBeInTheDocument();

    Object.defineProperty(genres, "scrollLeft", {
      configurable: true,
      value: 480,
      writable: true,
    });
    fireEvent.scroll(genres);
    expect(screen.getByRole("button", {
      name: "Show previous genres",
    })).toBeInTheDocument();
    expect(screen.queryByRole("button", {
      name: "Show more genres",
    })).not.toBeInTheDocument();

    expect(screen.getByRole("combobox", {
      name: "Sort Discover results",
    })).toHaveTextContent("Best-selling");
  });

  it("routes release and artist destinations through their explicit handlers", async () => {
    const onOpenArtist = vi.fn();
    const onOpenRelease = vi.fn();
    const onPlay = vi.fn();
    renderDiscover(vi.fn(), { onOpenArtist, onOpenRelease, onPlay });

    const title = await screen.findByRole("link", { name: "Blue Hours" });
    expect(title).toHaveAttribute(
      "href",
      "/discover/releases/discover%3Arelease-1?tag=&sort=top",
    );
    const card = title.closest("article");
    expect(card).toHaveAttribute(
      "data-discover-release-card",
      "discover:release-1",
    );
    expect(card?.querySelector("[data-coda-discover-artwork]")).toHaveAttribute(
      "data-coda-discover-artwork",
      "discover:release-1",
    );
    expect(
      card?.querySelector("a a, a button, button a"),
    ).not.toBeInTheDocument();
    expect(within(title).getByText("Blue Hours")).toHaveAttribute(
      "data-coda-discover-title",
      "discover:release-1",
    );
    fireEvent.click(title);
    expect(onOpenRelease).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: "discover:release-1",
        title: "Blue Hours",
      }),
      title,
    );

    const artwork = screen.getByRole("link", {
      name: "Open Blue Hours Discover details",
    });
    fireEvent.click(artwork);
    expect(onOpenRelease).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: "discover:release-1",
        title: "Blue Hours",
      }),
      artwork,
    );
    expect(mocks.openBandcampUrl).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Signal Garden" }));

    expect(onOpenArtist).toHaveBeenCalledWith(expect.objectContaining({
      id: "discover:release-1",
      artist: "Signal Garden",
    }));
    expect(onPlay).not.toHaveBeenCalled();
    expect(mocks.openBandcampUrl).not.toHaveBeenCalled();
  });

  it("keeps an invalid release identity as a safe action instead of an unsafe link", async () => {
    const invalidRelease = {
      id: "release-without-discover-provenance",
      title: "Untrusted Release",
      artist: "Signal Garden",
      itemUrl: "https://signal-garden.bandcamp.com/album/untrusted-release",
    };
    const onOpenRelease = vi.fn();
    mocks.fetchDiscover.mockResolvedValueOnce({
      results: [invalidRelease],
      resultCount: 1,
      hasMore: false,
    });

    renderDiscover(vi.fn(), { onOpenRelease });

    const title = await screen.findByRole("button", {
      name: "Untrusted Release",
    });
    expect(screen.queryByRole("link", {
      name: "Untrusted Release",
    })).not.toBeInTheDocument();
    fireEvent.click(title);
    expect(onOpenRelease).toHaveBeenCalledWith(invalidRelease, title);
    expect(title.closest("article")?.querySelector(
      "a a, a button, button a",
    )).not.toBeInTheDocument();
  });

  it("exposes the active genre and sort as pressed controls", async () => {
    const user = userEvent.setup();
    renderDiscover();

    await screen.findByText("Blue Hours");
    const allGenres = screen.getByRole("button", { name: "All genres" });
    expect(allGenres).toHaveAttribute("aria-pressed", "true");
    expect(
      allGenres.querySelector("[data-selection-rail-indicator]"),
    ).toHaveClass("pointer-events-none");
    expect(allGenres).not.toHaveClass("overflow-hidden");
    expect(
      allGenres.querySelector("[data-selection-rail-indicator]"),
    ).toHaveClass("rounded-sm");

    fireEvent.click(screen.getByRole("button", { name: "Rock" }));
    expect(screen.getByRole("button", { name: "Rock" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen
        .getByRole("button", { name: "Rock" })
        .querySelector("[data-selection-rail-indicator]"),
    ).toHaveAttribute("data-selection-travel-steps", "2");
    expect(allGenres).toHaveAttribute("aria-pressed", "false");

    await waitFor(() =>
      expect(mocks.fetchDiscover).toHaveBeenLastCalledWith(
        expect.objectContaining({ tag: "rock" }),
        "*",
      ),
    );
    const sort = screen.getByRole("combobox", {
      name: "Sort Discover results",
    });
    await waitFor(() => expect(sort).not.toBeDisabled());
    await user.click(sort);
    await user.click(await screen.findByRole("option", {
      name: "New arrivals",
    }));
    expect(sort).toHaveTextContent("New arrivals");
    await waitFor(() =>
      expect(mocks.fetchDiscover).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: "new" }),
        "*",
      ),
    );
  });

  it("appends the next page of discoveries using the returned cursor", async () => {
    mocks.fetchDiscover
      .mockResolvedValueOnce({
        results: [{
          id: "discover:release-1",
          title: "Blue Hours",
          artist: "Signal Garden",
          location: "Chicago, Illinois",
          itemUrl: "https://signal-garden.bandcamp.com/album/blue-hours",
        }],
        resultCount: 2,
        hasMore: true,
        cursor: "next-page",
      })
      .mockResolvedValueOnce({
        results: [{
          id: "discover:release-2",
          title: "Amber Transit",
          artist: "Signal Garden",
          location: "Chicago, Illinois",
          itemUrl: "https://signal-garden.bandcamp.com/album/amber-transit",
        }],
        resultCount: 2,
        hasMore: false,
      });
    renderDiscover();

    await screen.findByText("Blue Hours");
    fireEvent.click(screen.getByRole("button", { name: "View more discoveries" }));

    expect(await screen.findByText("Amber Transit")).toBeInTheDocument();
    expect(mocks.fetchDiscover).toHaveBeenLastCalledWith(
      expect.objectContaining({ tag: "", sort: "top" }),
      "next-page",
    );
  });

  it("keeps accumulated Discover releases bounded with working visible actions", async () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    const originalResizeObserver = globalThis.ResizeObserver;
    class ResizeObserverMock implements ResizeObserver {
      private readonly observed = new WeakSet<Element>();
      constructor(private readonly callback: ResizeObserverCallback) {}
      disconnect() {}
      observe(target: Element) {
        if (this.observed.has(target)) return;
        this.observed.add(target);
        const bounds = target.getBoundingClientRect();
        this.callback([{
          borderBoxSize: [{
            blockSize: bounds.height,
            inlineSize: bounds.width,
          }],
          contentRect: bounds,
          target,
        } as unknown as ResizeObserverEntry], this);
      }
      unobserve() {}
    }
    globalThis.ResizeObserver = ResizeObserverMock;
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      const scrollElement = this.hasAttribute("data-coda-library-scroll");
      const top = scrollElement ? 0 : 160;
      const height = scrollElement ? 240 : 0;
      return {
        bottom: top + height,
        height,
        left: 0,
        right: 900,
        top,
        width: 900,
        x: 0,
        y: top,
        toJSON: () => undefined,
      };
    };

    try {
      const releases = Array.from({ length: 5_000 }, (_, index) => ({
        id: `discover:release-${index}`,
        title: `Discover release ${index}`,
        artist: `Discover artist ${index}`,
        itemUrl: `https://artist-${index}.bandcamp.com/album/release-${index}`,
        featuredTrack: {
          id: `preview-${index}`,
          title: `Preview track ${index}`,
          duration: 180,
          streamUrl: `https://t4.bcbits.com/stream/${index}`,
        },
      }));
      const onOpenRelease = vi.fn();
      const onTogglePlayback = vi.fn();
      mocks.fetchDiscover.mockResolvedValueOnce({
        results: releases,
        resultCount: releases.length,
        hasMore: false,
      });
      renderDiscover(vi.fn(), {
        currentTrackId: "preview-0",
        onOpenRelease,
        onTogglePlayback,
        playing: true,
      });

      const grid = await screen.findByRole("list", {
        name: "Discover releases",
      });
      await waitFor(() => {
        expect(grid).toHaveAttribute("data-virtualized", "true");
        const cards = within(grid).getAllByRole("listitem");
        expect(cards.length).toBeGreaterThan(0);
        expect(cards.length).toBeLessThan(50);
      });
      expect(within(grid).getAllByRole("listitem")[0]).toHaveAttribute(
        "aria-setsize",
        "5000",
      );

      fireEvent.click(within(grid).getByRole("button", {
        name: "Pause Preview track 0",
      }));
      expect(onTogglePlayback).toHaveBeenCalledOnce();
      const openRelease = within(grid).getByRole("link", {
        name: "Discover release 0",
      });
      openRelease.focus();
      expect(openRelease).toHaveFocus();
      fireEvent.click(openRelease);
      expect(onOpenRelease).toHaveBeenCalledWith(releases[0], openRelease);
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect;
      globalThis.ResizeObserver = originalResizeObserver;
    }
  });

  it("keeps prior discoveries visible when their revalidation fails", async () => {
    mocks.fetchDiscover.mockResolvedValueOnce({
      results: [{
        id: "discover:release-1",
        title: "Blue Hours",
        artist: "Signal Garden",
        location: "Chicago, Illinois",
        itemUrl: "https://signal-garden.bandcamp.com/album/blue-hours",
      }],
      resultCount: 1,
      hasMore: false,
    }).mockRejectedValueOnce(new Error("Network unavailable"));
    const { client } = renderDiscover();

    await screen.findByText("Blue Hours");
    await client.invalidateQueries({ queryKey: ["discover"] });

    expect(await screen.findByText("Blue Hours")).toBeInTheDocument();
  });

  it("keeps the active preview control visible and matched to playback", async () => {
    const { onTogglePlayback } = renderDiscover(vi.fn(), {
      currentTrackId: "preview-1",
      playing: true,
    });

    await screen.findByText("Blue Hours");
    const pause = screen.getByRole("button", { name: "Pause Glass Lines" });
    expect(pause).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(pause);
    expect(onTogglePlayback).toHaveBeenCalledOnce();
  });
});
