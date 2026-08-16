import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterContextProvider } from "@tanstack/react-router";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlaybackClock } from "./playbackClock";
import type { RadioQueryRepository } from "./queries/radioQueries";
import { createCodaMemoryRouter } from "./router";
import type { RadioShow, RadioShowSummary, Track } from "./types";
import { transitionCodaView } from "./viewTransitions";

type RadioTestServices = RadioQueryRepository &
  Readonly<{
    openBandcampUrl: (url: string) => Promise<void>;
    transitionKinds: Parameters<typeof transitionCodaView>[1][];
  }>;

const radioServices: RadioTestServices = {
  fetchShow: vi.fn(),
  fetchShows: vi.fn(),
  openBandcampUrl: vi.fn(),
  transitionKinds: [],
};

function transition(
  ...args: Parameters<typeof transitionCodaView>
): ReturnType<typeof transitionCodaView> {
  radioServices.transitionKinds.push(args[1]);
  return transitionCodaView(...args);
}

import RadioView from "./RadioView";

const shows: RadioShowSummary[] = [
  {
    id: 979,
    subtitle: "Kinrose",
    description: "A deep listen to new independent hip-hop.",
    publishedAt: "24 Jul 2026 00:00:00 GMT",
    artworkUrl: "https://f4.bcbits.com/img/0046240870_10.jpg",
    series: {
      id: 5,
      title: "The Hip Hop Show",
      slug: "the-hip-hop-show",
    },
  },
  {
    id: 978,
    subtitle: "The Best of 2026",
    description: "Recent favorites from around the world.",
    publishedAt: "17 Jul 2026 00:00:00 GMT",
    series: {
      id: 2,
      title: "Bandcamp Selects",
      slug: "bandcamp-selects",
    },
  },
];

const show: RadioShow = {
  ...shows[0],
  title: "The Hip Hop Show",
  duration: 4_937,
  streamUrl: "https://bandcamp.com/stream_redirect?enc=mp3-128",
  chapters: [
    {
      title: "Mirage",
      artist: "Sweeps",
      album: "Mirage",
      timecode: 120,
      itemUrl: "https://sweepsbeats.bandcamp.com/track/mirage-w-keylime",
      artistUrl: "https://sweepsbeats.bandcamp.com/",
      albumUrl: "https://sweepsbeats.bandcamp.com/album/mirage",
      artworkUrl: "https://f4.bcbits.com/img/0161226005_10.jpg",
    },
  ],
};

function renderRadio(
  onPlay = vi.fn<(track: Track) => void>(),
  onQueue = vi.fn<(track: Track) => void>(),
  onPlayAt = vi.fn<(track: Track, position: number) => void>(),
  playback: {
    currentTrackId?: string;
    currentTime?: number;
    playing?: boolean;
    onTogglePlayback?: () => void;
    requestedShowId?: number;
    warmArchive?: boolean;
  } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (playback.warmArchive) {
    client.setQueryData(["bandcamp-radio", "all"], {
      pages: [{ results: shows, hasMore: false }],
      pageParams: [null],
    });
  }
  const onTogglePlayback = playback.onTogglePlayback ?? vi.fn();
  const onToggleFavorite = vi.fn();
  const router = createCodaMemoryRouter(client, ["/radio"]);
  function ControlledRadioView() {
    const [selectedSeriesId, setSelectedSeriesId] = useState<number>();
    const [requestedShowId, setRequestedShowId] = useState<number | undefined>(
      playback.requestedShowId,
    );
    return (
      <RadioView
        onPlay={onPlay}
        onQueue={onQueue}
        onPlayAt={onPlayAt}
        currentTrackId={playback.currentTrackId}
        playbackClock={createPlaybackClock(playback.currentTime ?? 0)}
        playing={playback.playing ?? false}
        onTogglePlayback={onTogglePlayback}
        favoriteShowIds={new Set()}
        onToggleFavorite={onToggleFavorite}
        selectedSeriesId={selectedSeriesId}
        onSelectSeries={setSelectedSeriesId}
        requestedShowId={requestedShowId}
        onRequestedShowChange={setRequestedShowId}
        openExternal={radioServices.openBandcampUrl}
        repository={radioServices}
        transition={transition}
      />
    );
  }
  render(
    <QueryClientProvider client={client}>
      <RouterContextProvider router={router}>
        <div
          data-coda-library-scroll
          style={{ height: 600, overflowY: "auto" }}
        >
          <ControlledRadioView />
        </div>
      </RouterContextProvider>
    </QueryClientProvider>,
  );
  return {
    onPlay,
    onQueue,
    onPlayAt,
    onTogglePlayback,
    onToggleFavorite,
  };
}

beforeEach(() => {
  vi.mocked(radioServices.fetchShow).mockReset().mockResolvedValue(show);
  vi.mocked(radioServices.fetchShows).mockReset().mockResolvedValue({
    results: shows,
    hasMore: false,
  });
  vi.mocked(radioServices.openBandcampUrl)
    .mockReset()
    .mockResolvedValue(undefined);
  radioServices.transitionKinds.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Bandcamp Radio", () => {
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

  it("loads the archive and plays the latest signed show stream", async () => {
    const { onPlay } = renderRadio();

    await screen.findByRole("heading", { name: "Kinrose" });
    expect(screen.getByText("2 broadcasts loaded")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Play latest show" }));

    await waitFor(() =>
      expect(radioServices.fetchShow).toHaveBeenCalledWith(979),
    );
    expect(onPlay).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "radio:979",
        artist: "Bandcamp Radio",
        album: "The Hip Hop Show",
        streamUrl: show.streamUrl,
        radioChapters: show.chapters,
      }),
    );
  });

  it("matches the latest show button to Now Playing and toggles it without reloading", async () => {
    const onTogglePlayback = vi.fn();
    renderRadio(vi.fn(), vi.fn(), vi.fn(), {
      currentTrackId: "radio:979",
      playing: true,
      onTogglePlayback,
    });

    await screen.findByRole("heading", { name: "Kinrose" });
    const pause = screen.getByRole("button", { name: "Pause latest show" });
    expect(pause).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(pause);

    expect(onTogglePlayback).toHaveBeenCalledOnce();
    expect(radioServices.fetchShow).not.toHaveBeenCalled();
  });

  it("adds an archive show to the queue and opens only its verified Bandcamp page", async () => {
    const archiveShow = { ...show, ...shows[1], title: "Bandcamp Weekly" };
    vi.mocked(radioServices.fetchShow).mockResolvedValueOnce(archiveShow);
    const { onQueue } = renderRadio();

    await screen.findByRole("heading", { name: "The Best of 2026" });
    const queueShow = screen.getByRole("button", {
      name: "Add The Best of 2026 to queue",
    });
    fireEvent.click(queueShow);
    await waitFor(() =>
      expect(onQueue).toHaveBeenCalledWith(
        expect.objectContaining({ id: "radio:978" }),
      ),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open The Best of 2026 on Bandcamp",
      }),
    );
    expect(radioServices.openBandcampUrl).toHaveBeenCalledWith(
      "https://bandcamp.com/radio?show=978",
    );
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

  it("commits the safe summary shell before signed show media resolves", async () => {
    let resolveShow!: (value: RadioShow) => void;
    vi.mocked(radioServices.fetchShow).mockReturnValue(
      new Promise((resolve) => {
        resolveShow = resolve;
      }),
    );
    renderRadio();

    await screen.findByRole("heading", { name: "Kinrose" });
    const archiveArtwork = document.querySelector<HTMLElement>(
      '[data-radio-show-artwork="979"]',
    );
    const archiveImage = archiveArtwork?.querySelector("img");
    if (!archiveImage) throw new Error("Expected archive Radio artwork.");
    fireEvent.load(archiveImage);

    fireEvent.click(screen.getByRole("link", { name: "View tracklist" }));

    expect(await screen.findByRole("button", { name: "Back" })).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Kinrose", level: 1 }),
    ).toBeVisible();
    const detailArtwork = document.querySelector<HTMLElement>(
      '[data-coda-radio-artwork-detail="979"]',
    );
    expect(detailArtwork?.querySelector("img")).not.toHaveClass("invisible");
    expect(
      detailArtwork?.querySelector("[data-radio-show-artwork-fallback]"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("status", {
        name: "Loading Radio show tracklist",
      }),
    ).toHaveAttribute("aria-busy", "true");
    expect(
      screen.getByRole("button", { name: "Loading show audio" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Add to queue" }),
    ).toBeDisabled();
    expect(radioServices.fetchShow).toHaveBeenCalledTimes(1);

    await act(async () => resolveShow(show));

    expect(
      await screen.findByRole("button", {
        name: "Play Mirage from 2:00",
      }),
    ).toBeEnabled();
    expect(radioServices.fetchShow).toHaveBeenCalledTimes(1);
  });

  it("retains the safe summary shell when signed show loading fails", async () => {
    let rejectShow!: (reason?: Error) => void;
    vi.mocked(radioServices.fetchShow).mockReturnValue(
      new Promise((_, reject) => {
        rejectShow = (reason) => reject(reason);
      }),
    );
    renderRadio();

    await screen.findByRole("heading", { name: "Kinrose" });
    fireEvent.click(screen.getByRole("link", { name: "View tracklist" }));
    await screen.findByRole("button", { name: "Back" });

    await act(async () => {
      rejectShow(new Error("The signed Radio stream expired"));
    });

    expect(
      screen.getByRole("heading", { name: "Kinrose", level: 1 }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Back" })).toBeVisible();
    expect(
      await screen.findByText("Tracklist unavailable"),
    ).toBeInTheDocument();
    expect(screen.getByText("The signed Radio stream expired")).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Show audio unavailable" }),
    ).toBeDisabled();
  });

  it("opens show details lazily and plays a chapter from its timecode", async () => {
    const { onPlayAt } = renderRadio();

    await screen.findByRole("heading", { name: "Kinrose" });
    expect(radioServices.fetchShow).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("link", { name: "View tracklist" }));

    await screen.findByRole("button", {
      name: "Play Mirage from 2:00",
    });
    expect(radioServices.fetchShow).toHaveBeenCalledWith(979);

    expect(onPlayAt).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Play Mirage from 2:00",
      }),
    );
    expect(onPlayAt).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "radio:979",
        radioChapters: show.chapters,
      }),
      120,
    );
  });

  it("moves focus into a show and restores its tracklist trigger on Back", async () => {
    renderRadio();

    await screen.findByRole("heading", { name: "Kinrose" });
    const tracklistButton = screen.getByRole("link", {
      name: "View tracklist",
    });
    tracklistButton.focus();
    fireEvent.click(tracklistButton);

    await screen.findByRole("heading", { name: "Songs in this show" });
    const detailHeading = document.getElementById("radio-detail-title");
    expect(detailHeading).not.toBeNull();
    expect(detailHeading?.parentElement).toHaveAttribute(
      "data-coda-radio-metadata-detail",
    );
    expect(
      document.querySelectorAll("[data-coda-radio-metadata-detail]"),
    ).toHaveLength(1);
    await waitFor(() => expect(detailHeading).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    const restoredTracklistButton = await screen.findByRole("link", {
      name: "View tracklist",
    });
    await waitFor(() => expect(restoredTracklistButton).toHaveFocus());
    expect(
      document.querySelector("[data-coda-radio-metadata-detail]"),
    ).not.toBeInTheDocument();
  });

  it("pairs Radio artwork in both directions and restores context before the Back snapshot", async () => {
    const snapshots: Array<{
      sourceBefore?: string | null;
      sourceTitleBefore?: string | null;
      sourceTitleCount: number;
      detailAfter?: string | null;
      detailTitleAfter?: string | null;
      returningAfter?: string | null;
      returningTitleAfter?: string | null;
      scrollTopAfter: number;
      focusedShowAfter?: string;
    }> = [];
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "startViewTransition",
    );
    let sourceTitleElement: Element | null = null;
    const startViewTransition = vi.fn((update: () => void) => {
      const sourceBefore = document
        .querySelector("[data-coda-radio-artwork-source]")
        ?.getAttribute("data-coda-radio-artwork-source");
      sourceTitleElement = document.querySelector(
        "[data-coda-radio-title-source]",
      );
      const sourceTitleBefore = sourceTitleElement?.getAttribute(
        "data-coda-radio-title-source",
      );
      const sourceTitleCount = document.querySelectorAll(
        "[data-coda-radio-title-source]",
      ).length;
      update();
      const activeElement = document.activeElement;
      snapshots.push({
        sourceBefore,
        sourceTitleBefore,
        sourceTitleCount,
        detailAfter: document
          .querySelector("[data-coda-radio-artwork-detail]")
          ?.getAttribute("data-coda-radio-artwork-detail"),
        detailTitleAfter: document
          .querySelector("[data-coda-radio-title-detail]")
          ?.getAttribute("data-coda-radio-title-detail"),
        returningAfter: document
          .querySelector("[data-coda-radio-artwork-return]")
          ?.getAttribute("data-coda-radio-artwork-return"),
        returningTitleAfter: document
          .querySelector("[data-coda-radio-title-return]")
          ?.getAttribute("data-coda-radio-title-return"),
        scrollTopAfter:
          document.querySelector<HTMLElement>("[data-coda-library-scroll]")
            ?.scrollTop ?? -1,
        focusedShowAfter:
          activeElement instanceof HTMLElement
            ? activeElement.dataset.radioShowOpen
            : undefined,
      });
      return { finished: Promise.resolve() };
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    try {
      renderRadio();

      await screen.findByRole("heading", { name: "Kinrose" });
      const scrollRoot = document.querySelector<HTMLElement>(
        "[data-coda-library-scroll]",
      );
      expect(scrollRoot).not.toBeNull();
      if (scrollRoot) scrollRoot.scrollTop = 287;
      const tracklistButton = screen.getByRole("link", {
        name: "View tracklist",
      });
      tracklistButton.focus();
      fireEvent.click(tracklistButton);

      await screen.findByRole("heading", { name: "Songs in this show" });
      await waitFor(() =>
        expect(sourceTitleElement).not.toHaveAttribute(
          "data-coda-radio-title-source",
        ),
      );
      if (scrollRoot) scrollRoot.scrollTop = 0;
      fireEvent.click(screen.getByRole("button", { name: "Back" }));

      await screen.findByRole("heading", { name: "Kinrose" });
      expect(startViewTransition).toHaveBeenCalledTimes(2);
      expect(radioServices.transitionKinds).toEqual([
        "radio-detail",
        "radio-detail-close",
      ]);
      expect(snapshots).toEqual([
        expect.objectContaining({
          sourceBefore: "979",
          sourceTitleBefore: "979",
          sourceTitleCount: 1,
          detailAfter: "979",
          detailTitleAfter: "979",
        }),
        expect.objectContaining({
          returningAfter: "979",
          returningTitleAfter: "979",
          scrollTopAfter: 287,
          focusedShowAfter: "979",
        }),
      ]);
      await waitFor(() =>
        expect(
          document.querySelector(
            "[data-coda-radio-artwork-return], [data-coda-radio-title-return]",
          ),
        ).not.toBeInTheDocument(),
      );
    } finally {
      document.documentElement.classList.remove(
        "coda-transition--radio-detail",
        "coda-transition--radio-detail-close",
      );
      if (originalDescriptor) {
        Object.defineProperty(
          document,
          "startViewTransition",
          originalDescriptor,
        );
      } else {
        Reflect.deleteProperty(document, "startViewTransition");
      }
    }
  });

  it("pairs the exact archive show title and cleans every temporary title marker", async () => {
    const archiveShow = {
      ...show,
      ...shows[1],
      title: "Bandcamp Selects",
    };
    vi.mocked(radioServices.fetchShow).mockResolvedValueOnce(archiveShow);
    const snapshots: Array<{
      sourceTitle?: string | null;
      sourceTitleIsStatic: boolean;
      sourceTitleCount: number;
      detailTitle?: string | null;
      returningTitle?: string | null;
      returningTitleIsStatic: boolean;
      returningTitleCount: number;
    }> = [];
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "startViewTransition",
    );
    let detachedSourceTitle: Element | null = null;
    const startViewTransition = vi.fn((update: () => void) => {
      detachedSourceTitle = document.querySelector(
        "[data-coda-radio-title-source]",
      );
      const sourceTitle = detachedSourceTitle?.getAttribute(
        "data-coda-radio-title-source",
      );
      const sourceTitleCount = document.querySelectorAll(
        "[data-coda-radio-title-source]",
      ).length;
      update();
      snapshots.push({
        sourceTitle,
        sourceTitleIsStatic:
          detachedSourceTitle?.matches('[data-slot="overflow-marquee-text"]') ??
          false,
        sourceTitleCount,
        detailTitle: document
          .querySelector("[data-coda-radio-title-detail]")
          ?.getAttribute("data-coda-radio-title-detail"),
        returningTitle: document
          .querySelector("[data-coda-radio-title-return]")
          ?.getAttribute("data-coda-radio-title-return"),
        returningTitleIsStatic:
          document
            .querySelector("[data-coda-radio-title-return]")
            ?.matches('[data-slot="overflow-marquee-text"]') ?? false,
        returningTitleCount: document.querySelectorAll(
          "[data-coda-radio-title-return]",
        ).length,
      });
      return { finished: Promise.resolve() };
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    try {
      renderRadio();

      await screen.findByRole("heading", { name: "Kinrose" });
      expect(document.querySelectorAll("[data-radio-show-title]")).toHaveLength(
        2,
      );
      fireEvent.click(
        screen.getByRole("link", {
          name: "View tracklist for The Best of 2026",
        }),
      );

      await screen.findByRole("heading", { name: "Songs in this show" });
      await waitFor(() =>
        expect(detachedSourceTitle).not.toHaveAttribute(
          "data-coda-radio-title-source",
        ),
      );
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
      await screen.findByRole("heading", { name: "Kinrose" });

      expect(snapshots).toEqual([
        expect.objectContaining({
          sourceTitle: "978",
          sourceTitleIsStatic: true,
          sourceTitleCount: 1,
          detailTitle: "978",
          returningTitleIsStatic: false,
          returningTitleCount: 0,
        }),
        expect.objectContaining({
          sourceTitleCount: 0,
          sourceTitleIsStatic: false,
          returningTitle: "978",
          returningTitleIsStatic: true,
          returningTitleCount: 1,
        }),
      ]);
      await waitFor(() =>
        expect(
          document.querySelector(
            "[data-coda-radio-title-source], [data-coda-radio-title-return]",
          ),
        ).not.toBeInTheDocument(),
      );
    } finally {
      document.documentElement.classList.remove(
        "coda-transition--radio-detail",
        "coda-transition--radio-detail-close",
      );
      if (originalDescriptor) {
        Object.defineProperty(
          document,
          "startViewTransition",
          originalDescriptor,
        );
      } else {
        Reflect.deleteProperty(document, "startViewTransition");
      }
    }
  });

  it("falls back to page motion when the source Radio artwork is unavailable", async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "startViewTransition",
    );
    const startViewTransition = vi.fn();
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    try {
      renderRadio();

      await screen.findByRole("heading", { name: "Kinrose" });
      document
        .querySelector('[data-radio-show-artwork="979"]')
        ?.removeAttribute("data-radio-show-artwork");
      fireEvent.click(
        screen.getByRole("link", {
          name: "View tracklist",
        }),
      );

      await screen.findByRole("heading", { name: "Songs in this show" });
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
      await screen.findByRole("heading", { name: "Kinrose" });

      expect(startViewTransition).not.toHaveBeenCalled();
      expect(radioServices.transitionKinds).toEqual([
        "page-forward",
        "page-back",
      ]);
      expect(
        document.querySelector(
          "[data-coda-radio-artwork-return], [data-coda-radio-title-return]",
        ),
      ).not.toBeInTheDocument();
    } finally {
      document.documentElement.classList.remove(
        "coda-transition--page-forward",
        "coda-transition--page-back",
      );
      if (originalDescriptor) {
        Object.defineProperty(
          document,
          "startViewTransition",
          originalDescriptor,
        );
      } else {
        Reflect.deleteProperty(document, "startViewTransition");
      }
    }
  });

  it("keeps the live chapter highlighted in the Radio detail tracklist", async () => {
    renderRadio(vi.fn(), vi.fn(), vi.fn(), {
      currentTrackId: "radio:979",
      currentTime: 130,
      playing: true,
    });

    await screen.findByRole("heading", { name: "Kinrose" });
    fireEvent.click(screen.getByRole("link", { name: "View tracklist" }));

    const pauseChapter = await screen.findByRole("button", {
      name: "Pause Mirage",
    });
    expect(pauseChapter).toHaveAttribute("aria-pressed", "true");
    expect(pauseChapter.closest("li")).toHaveAttribute("aria-current", "true");
  });

  it("keeps requested show loading visible over a warm archive until details arrive", async () => {
    const requestedShow = {
      ...show,
      id: 977,
      subtitle: "Deep Focus",
    };
    let resolveShow!: (value: RadioShow) => void;
    vi.mocked(radioServices.fetchShow).mockReturnValue(
      new Promise((resolve) => {
        resolveShow = resolve;
      }),
    );

    renderRadio(vi.fn(), vi.fn(), vi.fn(), {
      requestedShowId: requestedShow.id,
      warmArchive: true,
    });

    expect(
      await screen.findByRole("status", {
        name: "Loading Radio show details",
      }),
    ).toBeInTheDocument();

    resolveShow(requestedShow);

    expect(
      await screen.findByRole("heading", {
        name: "Deep Focus",
      }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByRole("status", {
          name: "Loading Radio show details",
        }),
      ).not.toBeInTheDocument(),
    );
  });
});
