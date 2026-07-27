import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlaybackClock } from "./playbackClock";
import type { RadioShow, RadioShowSummary, Track } from "./types";

const mocks = vi.hoisted(() => ({
  fetchRadioShow: vi.fn(),
  fetchRadioShows: vi.fn(),
  openBandcampUrl: vi.fn(),
}));

vi.mock("./lib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib")>();
  return {
    ...actual,
    fetchRadioShow: mocks.fetchRadioShow,
    fetchRadioShows: mocks.fetchRadioShows,
    openBandcampUrl: mocks.openBandcampUrl,
  };
});

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
  } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onTogglePlayback = playback.onTogglePlayback ?? vi.fn();
  const onToggleFavorite = vi.fn();
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
      />
    );
  }
  render(
    <QueryClientProvider client={client}>
      <ControlledRadioView />
    </QueryClientProvider>,
  );
  return { onPlay, onQueue, onPlayAt, onTogglePlayback, onToggleFavorite };
}

beforeEach(() => {
  mocks.fetchRadioShow.mockReset().mockResolvedValue(show);
  mocks.fetchRadioShows.mockReset().mockResolvedValue({
    results: shows,
    hasMore: false,
  });
  mocks.openBandcampUrl.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Bandcamp Radio", () => {
  it("disables show actions and labels the request while loading playback", async () => {
    let resolveShow!: (value: RadioShow) => void;
    mocks.fetchRadioShow.mockReturnValue(new Promise((resolve) => {
      resolveShow = resolve;
    }));
    const { onPlay } = renderRadio();

    await screen.findByRole("heading", { name: "Kinrose" });
    fireEvent.click(screen.getByRole("button", { name: "Play latest show" }));

    expect(await screen.findByRole("button", { name: "Loading show…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add to queue" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "View tracklist" })).toBeDisabled();

    resolveShow(show);
    await waitFor(() => expect(onPlay).toHaveBeenCalled());
  });

  it("loads the archive and plays the latest signed show stream", async () => {
    const { onPlay } = renderRadio();

    expect(await screen.findByRole("heading", { name: "Kinrose" })).toBeInTheDocument();
    expect(screen.getByText("2 broadcasts loaded")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Play latest show" }));

    await waitFor(() => expect(mocks.fetchRadioShow).toHaveBeenCalledWith(979));
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({
      id: "radio:979",
      artist: "Bandcamp Radio",
      album: "The Hip Hop Show",
      streamUrl: show.streamUrl,
      radioChapters: show.chapters,
    }));
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
    expect(mocks.fetchRadioShow).not.toHaveBeenCalled();
  });

  it("adds an archive show to the queue and opens only its verified Bandcamp page", async () => {
    const archiveShow = { ...show, ...shows[1], title: "Bandcamp Weekly" };
    mocks.fetchRadioShow.mockResolvedValueOnce(archiveShow);
    const { onQueue } = renderRadio();

    await screen.findByRole("heading", { name: "The Best of 2026" });
    fireEvent.click(screen.getByRole("button", {
      name: "Add The Best of 2026 to queue",
    }));
    await waitFor(() => expect(onQueue).toHaveBeenCalledWith(
      expect.objectContaining({ id: "radio:978" }),
    ));

    fireEvent.click(screen.getByRole("button", {
      name: "Open The Best of 2026 on Bandcamp",
    }));
    expect(mocks.openBandcampUrl).toHaveBeenCalledWith(
      "https://bandcamp.com/radio?show=978",
    );
  });

  it("routes every Radio series label to its in-Coda episode archive", async () => {
    renderRadio();

    await screen.findByRole("heading", { name: "Kinrose" });
    fireEvent.click(screen.getAllByRole("button", {
      name: "Browse The Hip Hop Show episodes",
    })[0]);
    await waitFor(() => expect(mocks.fetchRadioShows).toHaveBeenCalledWith({
      seriesId: 5,
      cursor: undefined,
    }));
  });

  it("loads the next bounded Radio page automatically near the scroll edge", async () => {
    vi.stubGlobal("IntersectionObserver", class {
      private readonly callback: IntersectionObserverCallback;

      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
      }

      observe() {
        this.callback(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        );
      }

      disconnect() {}
      unobserve() {}
      takeRecords() { return []; }
      root = null;
      rootMargin = "420px 0px";
      thresholds = [0];
    });
    mocks.fetchRadioShows
      .mockResolvedValueOnce({
        results: shows,
        cursor: "1770336000:901",
        hasMore: true,
      })
      .mockResolvedValueOnce({
        results: [{
          ...shows[1],
          id: 977,
          subtitle: "Next page",
        }],
        hasMore: false,
      });
    renderRadio();

    await screen.findByRole("heading", { name: "Kinrose" });
    expect(await screen.findByRole("heading", { name: "Next page" }))
      .toBeInTheDocument();
    expect(mocks.fetchRadioShows).toHaveBeenLastCalledWith({
      seriesId: undefined,
      cursor: "1770336000:901",
    });
  });

  it("favorites a Radio show without loading its signed stream", async () => {
    const { onToggleFavorite } = renderRadio();

    await screen.findByRole("heading", { name: "Kinrose" });
    fireEvent.click(screen.getByRole("button", {
      name: "Add Kinrose to favorites",
    }));

    expect(onToggleFavorite).toHaveBeenCalledWith(shows[0]);
    expect(mocks.fetchRadioShow).not.toHaveBeenCalled();
  });

  it("opens show details lazily and keeps link and play-from-here intent separate", async () => {
    const { onPlayAt } = renderRadio();

    await screen.findByRole("heading", { name: "Kinrose" });
    expect(mocks.fetchRadioShow).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "View tracklist" }));

    expect(await screen.findByRole("heading", {
      name: "Songs in this show",
    })).toBeInTheDocument();
    expect(mocks.fetchRadioShow).toHaveBeenCalledWith(979);

    fireEvent.click(screen.getByRole("button", {
      name: "Open Mirage by Sweeps on Bandcamp",
    }));
    expect(mocks.openBandcampUrl).toHaveBeenCalledWith(
      "https://sweepsbeats.bandcamp.com/track/mirage-w-keylime",
    );
    fireEvent.click(screen.getByRole("button", {
      name: "Open artist Sweeps on Bandcamp",
    }));
    expect(mocks.openBandcampUrl).toHaveBeenCalledWith(
      "https://sweepsbeats.bandcamp.com/",
    );
    fireEvent.click(screen.getByRole("button", {
      name: "Open album Mirage on Bandcamp",
    }));
    expect(mocks.openBandcampUrl).toHaveBeenCalledWith(
      "https://sweepsbeats.bandcamp.com/album/mirage",
    );
    expect(document.querySelector(".radio-chapter-artwork img")).toHaveAttribute(
      "src",
      "https://f4.bcbits.com/img/0161226005_10.jpg",
    );
    expect(onPlayAt).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", {
      name: "Play Mirage from 2:00",
    }));
    expect(onPlayAt).toHaveBeenCalledWith(
      expect.objectContaining({ id: "radio:979", radioChapters: show.chapters }),
      120,
    );

    fireEvent.click(screen.getByRole("button", { name: "Browse all episodes" }));
    await waitFor(() => expect(mocks.fetchRadioShows).toHaveBeenCalledWith({
      seriesId: 5,
      cursor: undefined,
    }));
    expect(await screen.findByRole("heading", { name: "Kinrose" }))
      .toBeInTheDocument();
  });

  it("keeps the live chapter highlighted in the Radio detail tracklist", async () => {
    renderRadio(vi.fn(), vi.fn(), vi.fn(), {
      currentTrackId: "radio:979",
      currentTime: 130,
      playing: true,
    });

    await screen.findByRole("heading", { name: "Kinrose" });
    fireEvent.click(screen.getByRole("button", { name: "View tracklist" }));

    const pauseChapter = await screen.findByRole("button", { name: "Pause Mirage" });
    expect(pauseChapter).toHaveAttribute("aria-pressed", "true");
    expect(pauseChapter.closest("li")).toHaveClass("is-current");
  });

  it("opens a requested favorite episode through the shared TanStack detail cache", async () => {
    renderRadio(vi.fn(), vi.fn(), vi.fn(), { requestedShowId: 979 });

    expect(await screen.findByRole("heading", {
      name: "Songs in this show",
    })).toBeInTheDocument();
    expect(mocks.fetchRadioShow).toHaveBeenCalledWith(979);
  });
});
