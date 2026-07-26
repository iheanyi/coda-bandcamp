import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
  },
  {
    id: 978,
    subtitle: "The Best of 2026",
    description: "Recent favorites from around the world.",
    publishedAt: "17 Jul 2026 00:00:00 GMT",
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
  } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onTogglePlayback = playback.onTogglePlayback ?? vi.fn();
  const onToggleFavorite = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <RadioView
        onPlay={onPlay}
        onQueue={onQueue}
        onPlayAt={onPlayAt}
        currentTrackId={playback.currentTrackId}
        currentTime={playback.currentTime ?? 0}
        playing={playback.playing ?? false}
        onTogglePlayback={onTogglePlayback}
        favoriteShowIds={new Set()}
        onToggleFavorite={onToggleFavorite}
      />
    </QueryClientProvider>,
  );
  return { onPlay, onQueue, onPlayAt, onTogglePlayback, onToggleFavorite };
}

beforeEach(() => {
  mocks.fetchRadioShow.mockReset().mockResolvedValue(show);
  mocks.fetchRadioShows.mockReset().mockResolvedValue(shows);
  mocks.openBandcampUrl.mockReset().mockResolvedValue(undefined);
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
    expect(screen.getByText("2 broadcasts")).toBeInTheDocument();
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
    expect(onPlayAt).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", {
      name: "Play Mirage from 2:00",
    }));
    expect(onPlayAt).toHaveBeenCalledWith(
      expect.objectContaining({ id: "radio:979", radioChapters: show.chapters }),
      120,
    );

    fireEvent.click(screen.getByRole("button", { name: "Back to Radio" }));
    expect(screen.getByRole("heading", { name: "Kinrose" })).toBeInTheDocument();
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
});
