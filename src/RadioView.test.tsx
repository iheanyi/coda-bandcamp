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
  return {
    onPlay,
    onQueue,
    onPlayAt,
    onTogglePlayback,
    onToggleFavorite,
  };
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

    await screen.findByRole("heading", { name: "Kinrose" });
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
    const queueShow = screen.getByRole("button", {
      name: "Add The Best of 2026 to queue",
    });
    fireEvent.click(queueShow);
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

  it("opens show details lazily and plays a chapter from its timecode", async () => {
    const { onPlayAt } = renderRadio();

    await screen.findByRole("heading", { name: "Kinrose" });
    expect(mocks.fetchRadioShow).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "View tracklist" }));

    await screen.findByRole("heading", {
      name: "Songs in this show",
    });
    expect(mocks.fetchRadioShow).toHaveBeenCalledWith(979);

    expect(onPlayAt).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", {
      name: "Play Mirage from 2:00",
    }));
    expect(onPlayAt).toHaveBeenCalledWith(
      expect.objectContaining({ id: "radio:979", radioChapters: show.chapters }),
      120,
    );
  });

  it("moves focus into a show and restores its tracklist trigger on Back", async () => {
    renderRadio();

    await screen.findByRole("heading", { name: "Kinrose" });
    const tracklistButton = screen.getByRole("button", {
      name: "View tracklist",
    });
    tracklistButton.focus();
    fireEvent.click(tracklistButton);

    await screen.findByRole("heading", { name: "Songs in this show" });
    const detailHeading = document.getElementById("radio-detail-title");
    expect(detailHeading).not.toBeNull();
    await waitFor(() => expect(detailHeading).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "Back to Radio" }));

    const restoredTracklistButton = await screen.findByRole("button", {
      name: "View tracklist",
    });
    await waitFor(() => expect(restoredTracklistButton).toHaveFocus());
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
    expect(pauseChapter.closest("li")).toHaveAttribute("aria-current", "true");
  });

  it("keeps requested show loading visible over a warm archive until details arrive", async () => {
    const requestedShow = {
      ...show,
      id: 977,
      subtitle: "Deep Focus",
    };
    let resolveShow!: (value: RadioShow) => void;
    mocks.fetchRadioShow.mockReturnValue(new Promise((resolve) => {
      resolveShow = resolve;
    }));

    renderRadio(vi.fn(), vi.fn(), vi.fn(), {
      requestedShowId: requestedShow.id,
      warmArchive: true,
    });

    expect(await screen.findByRole("status", {
      name: "Loading Radio show details",
    })).toBeInTheDocument();

    resolveShow(requestedShow);

    expect(await screen.findByRole("heading", {
      name: "Deep Focus",
    })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole("status", {
        name: "Loading Radio show details",
      })).not.toBeInTheDocument()
    );
  });
});
