import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openBandcampUrl: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./lib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib")>();
  return {
    ...actual,
    openBandcampUrl: mocks.openBandcampUrl,
  };
});

import { NowPlayingView } from "./NowPlayingView";
import { Drawer } from "./components/ui/drawer";
import { createPlaybackClock } from "./playbackClock";
import { boundRadioChapters } from "./radioPlayback";
import type { Album, Track } from "./types";

const radioTrack: Track = {
  id: "radio:979",
  title: "Kinrose",
  artist: "Bandcamp Radio",
  album: "The Hip Hop Show",
  albumId: "radio:979",
  duration: 4_937,
  track: 1,
  palette: ["#234", "#112"],
  radioChapters: [
    {
      title: "Mirage",
      artist: "Sweeps",
      album: "Mirage",
      timecode: 30,
      itemUrl: "https://sweepsbeats.bandcamp.com/track/mirage-w-keylime",
      artistUrl: "https://sweepsbeats.bandcamp.com/",
      albumUrl: "https://sweepsbeats.bandcamp.com/album/mirage",
      artworkUrl: "https://f4.bcbits.com/img/0161226005_10.jpg",
    },
    { title: "Night Drive", artist: "Keylime", timecode: 120 },
  ],
};
const radioTimeline = boundRadioChapters(radioTrack.radioChapters ?? []);
const continuationAlbum: Album = {
  id: "album-22",
  title: "Soft Focus",
  artist: "Night Archive",
  songCount: 8,
  duration: 2_104,
  genre: "Ambient",
  palette: ["#6f6d86", "#1a1b25"],
};
const libraryTrack: Track = {
  ...radioTrack,
  id: "track-22",
  title: "Static Bloom",
  artist: "Night Archive",
  album: "Soft Focus",
  albumId: "album-22",
  radioChapters: undefined,
};

function renderNowPlaying(ui: ReactNode) {
  return render(ui, {
    wrapper: ({ children }) => <Drawer>{children}</Drawer>,
  });
}

beforeEach(() => {
  mocks.openBandcampUrl.mockClear();
});

describe("NowPlayingView Radio metadata", () => {
  it("announces a pending album transition and prevents repeated navigation", () => {
    const noOp = vi.fn();
    const onAlbum = vi.fn();
    const { rerender } = renderNowPlaying(
      <NowPlayingView
        track={libraryTrack}
        radioTimeline={[]}
        queue={[libraryTrack]}
        currentIndex={0}
        playing
        playbackClock={createPlaybackClock(45)}
        duration={libraryTrack.duration}
        volume={0.7}
        repeat="off"
        artwork={<span>Artwork</span>}
        airPlayAvailable={false}
        queueOpen={false}
        onBack={noOp}
        onToggle={noOp}
        onPrevious={noOp}
        onNext={noOp}
        canPrevious
        canNext
        onSeek={noOp}
        onVolume={noOp}
        onRepeat={noOp}
        onAirPlay={noOp}
        onArtist={noOp}
        onAlbum={onAlbum}
        albumLoading={false}
        onPlayQueueIndex={noOp}
        onRadioSeries={noOp}
        recommendationLoading={false}
        onPlayRecommendation={noOp}
        onAnotherRecommendation={noOp}
      />,
    );

    const albumLink = screen.getByRole("button", { name: "Soft Focus" });
    expect(
      within(screen.getByRole("heading", { name: "Static Bloom" }))
        .getByText("Static Bloom"),
    ).toHaveAttribute("data-coda-now-playing-title-detail", "");
    fireEvent.click(albumLink);
    expect(onAlbum).toHaveBeenCalledOnce();

    rerender(
      <NowPlayingView
        track={libraryTrack}
        radioTimeline={[]}
        queue={[libraryTrack]}
        currentIndex={0}
        playing
        playbackClock={createPlaybackClock(45)}
        duration={libraryTrack.duration}
        volume={0.7}
        repeat="off"
        artwork={<span>Artwork</span>}
        airPlayAvailable={false}
        queueOpen={false}
        onBack={noOp}
        onToggle={noOp}
        onPrevious={noOp}
        onNext={noOp}
        canPrevious
        canNext
        onSeek={noOp}
        onVolume={noOp}
        onRepeat={noOp}
        onAirPlay={noOp}
        onArtist={noOp}
        onAlbum={onAlbum}
        albumLoading
        onPlayQueueIndex={noOp}
        onRadioSeries={noOp}
        recommendationLoading={false}
        onPlayRecommendation={noOp}
        onAnotherRecommendation={noOp}
      />,
    );

    const pendingAlbumLink = screen.getByRole("button", {
      name: "Loading album Soft Focus",
    });
    expect(pendingAlbumLink).toBeDisabled();
    expect(pendingAlbumLink).toHaveAttribute("aria-busy", "true");
    expect(within(pendingAlbumLink).getByRole("status", {
      name: "Loading album Soft Focus",
    })).toBeInTheDocument();

    fireEvent.click(pendingAlbumLink);
    expect(onAlbum).toHaveBeenCalledOnce();
  });

  it("omits the release label when a standalone track has no album name", () => {
    const noOp = vi.fn();
    const onAlbum = vi.fn();
    const trackWithoutRelease = {
      ...libraryTrack,
      album: "Unknown release",
    };

    renderNowPlaying(
      <NowPlayingView
        track={trackWithoutRelease}
        radioTimeline={[]}
        queue={[trackWithoutRelease]}
        currentIndex={0}
        playing
        playbackClock={createPlaybackClock(45)}
        duration={trackWithoutRelease.duration}
        volume={0.7}
        repeat="off"
        artwork={<span>Artwork</span>}
        airPlayAvailable={false}
        queueOpen={false}
        onBack={noOp}
        onToggle={noOp}
        onPrevious={noOp}
        onNext={noOp}
        canPrevious
        canNext
        onSeek={noOp}
        onVolume={noOp}
        onRepeat={noOp}
        onAirPlay={noOp}
        onArtist={noOp}
        onAlbum={onAlbum}
        albumLoading={false}
        onPlayQueueIndex={noOp}
        onRadioSeries={noOp}
        recommendationLoading={false}
        onPlayRecommendation={noOp}
        onAnotherRecommendation={noOp}
      />,
    );

    const currentTrack = screen.getByRole("region", {
      name: "Current track",
    });
    expect(within(currentTrack).getByRole("button", {
      name: trackWithoutRelease.artist,
    })).toBeInTheDocument();
    expect(within(currentTrack).queryByText("Soft Focus")).not.toBeInTheDocument();
    expect(onAlbum).not.toHaveBeenCalled();
  });

  it("focuses the track heading and routes playback, queue, and slider state", () => {
    const onBack = vi.fn();
    const onToggle = vi.fn();
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    const onSeek = vi.fn();
    const onVolume = vi.fn();
    const onRepeat = vi.fn();
    const noOp = vi.fn();
    const playbackClock = createPlaybackClock(45);
    const view = (queueOpen: boolean) => (
      <NowPlayingView
        track={radioTrack}
        radioTimeline={radioTimeline}
        queue={[radioTrack]}
        currentIndex={0}
        playing
        playbackClock={playbackClock}
        duration={radioTrack.duration}
        volume={0.7}
        repeat="off"
        artwork={<span>Artwork</span>}
        airPlayAvailable={false}
        queueOpen={queueOpen}
        onBack={onBack}
        onToggle={onToggle}
        onPrevious={onPrevious}
        onNext={onNext}
        canPrevious
        canNext
        onSeek={onSeek}
        onVolume={onVolume}
        onRepeat={onRepeat}
        onAirPlay={noOp}
        onArtist={noOp}
        onAlbum={noOp}
        onPlayQueueIndex={noOp}
        onRadioSeries={noOp}
        recommendationLoading={false}
        onPlayRecommendation={noOp}
        onAnotherRecommendation={noOp}
      />
    );
    const { rerender } = renderNowPlaying(view(false));

    const radioHeading = screen.getByRole("heading", { name: "Kinrose" });
    expect(radioHeading).toHaveFocus();
    expect(radioHeading).not.toHaveAttribute(
      "data-coda-now-playing-title-detail",
    );

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Repeat off" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Show queue" }));

    expect(onBack).toHaveBeenCalledOnce();
    expect(onRepeat).toHaveBeenCalledOnce();
    expect(onPrevious).toHaveBeenCalledOnce();
    expect(onToggle).toHaveBeenCalledOnce();
    expect(onNext).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Show queue" }))
      .toHaveAttribute("aria-expanded", "true");

    const [position, volume] = screen.getAllByRole("slider", { hidden: true });
    expect(position).toHaveAttribute("aria-label", "Now playing position");
    expect(volume).toHaveAttribute("aria-label", "Volume");
    fireEvent.change(position, { target: { value: "46" } });
    expect(onSeek).toHaveBeenCalledWith(46);
    fireEvent.change(volume, { target: { value: "0.71" } });
    expect(onVolume).toHaveBeenCalledWith(0.71);

    rerender(view(true));
    expect(screen.queryByRole("group", { name: "Playback controls" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: "Volume" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hide queue" }))
      .not.toBeInTheDocument();
  });

  it("announces the currently airing chapter and its successor", () => {
    const noOp = vi.fn();
    const onSeek = vi.fn();
    const onRadioSeries = vi.fn();
    renderNowPlaying(
      <NowPlayingView
        track={radioTrack}
        radioTimeline={radioTimeline}
        queue={[radioTrack]}
        currentIndex={0}
        playing
        playbackClock={createPlaybackClock(45)}
        duration={radioTrack.duration}
        volume={0.7}
        repeat="off"
        artwork={<span>Artwork</span>}
        airPlayAvailable={false}
        queueOpen={false}
        onBack={noOp}
        onToggle={noOp}
        onPrevious={noOp}
        onNext={noOp}
        canPrevious
        canNext
        onSeek={onSeek}
        onVolume={noOp}
        onRepeat={noOp}
        onAirPlay={noOp}
        onArtist={noOp}
        onAlbum={noOp}
        onPlayQueueIndex={noOp}
        onRadioSeries={onRadioSeries}
        recommendationLoading={false}
        onPlayRecommendation={noOp}
        onAnotherRecommendation={noOp}
      />,
    );

    const currentlyAiring = screen.getByRole("region", {
      name: "Currently airing on Bandcamp Radio",
    });
    expect(currentlyAiring).toHaveTextContent("Mirage");
    expect(currentlyAiring).toHaveTextContent("Sweeps");
    expect(currentlyAiring).toHaveTextContent("Up next: Night Drive by Keylime");
    expect(screen.getByRole("status")).toHaveTextContent("Playing now");

    fireEvent.click(screen.getByRole("button", {
      name: "Open Kinrose on Bandcamp Radio",
    }));
    expect(mocks.openBandcampUrl).toHaveBeenCalledWith(
      "https://bandcamp.com/radio?show=979",
    );
    fireEvent.click(screen.getByRole("button", { name: "Bandcamp Radio" }));
    fireEvent.click(screen.getByRole("button", { name: "The Hip Hop Show" }));
    expect(onRadioSeries).toHaveBeenNthCalledWith(1);
    expect(onRadioSeries).toHaveBeenNthCalledWith(2, 5);

    const chapterList = screen.getByRole("list", {
      name: "Radio chapter timeline",
    });
    const currentTitle = within(chapterList).getByRole("button", {
      name: "Open Mirage by Sweeps on Bandcamp",
    });
    expect(currentTitle.closest("li")).toHaveAttribute("aria-current", "true");
    expect(within(chapterList).getByText("Up next")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", {
      name: "Seek to Mirage at 0:30",
    }));
    expect(onSeek).toHaveBeenCalledWith(30);
  });

  it("updates progress each second without rerendering Radio metadata inside a chapter", () => {
    const noOp = vi.fn();
    const playbackClock = createPlaybackClock(45);
    const getRadioChapterLocalLinks = vi.fn(() => ({}));
    renderNowPlaying(
      <NowPlayingView
        track={radioTrack}
        radioTimeline={radioTimeline}
        queue={[radioTrack]}
        currentIndex={0}
        playing
        playbackClock={playbackClock}
        duration={radioTrack.duration}
        volume={0.7}
        repeat="off"
        artwork={<span>Artwork</span>}
        airPlayAvailable={false}
        queueOpen={false}
        onBack={noOp}
        onToggle={noOp}
        onPrevious={noOp}
        onNext={noOp}
        canPrevious
        canNext
        onSeek={noOp}
        onVolume={noOp}
        onRepeat={noOp}
        onAirPlay={noOp}
        onArtist={noOp}
        onAlbum={noOp}
        onPlayQueueIndex={noOp}
        onRadioSeries={noOp}
        recommendationLoading={false}
        onPlayRecommendation={noOp}
        onAnotherRecommendation={noOp}
        getRadioChapterLocalLinks={getRadioChapterLocalLinks}
      />,
    );

    const initialMetadataReads = getRadioChapterLocalLinks.mock.calls.length;
    act(() => playbackClock.updateFromMedia(46.2));

    const [position] = screen.getAllByRole("slider", { hidden: true });
    expect(position).toHaveValue("46");
    expect(getRadioChapterLocalLinks).toHaveBeenCalledTimes(initialMetadataReads);

    act(() => playbackClock.updateFromMedia(120));
    expect(screen.getByRole("region", {
      name: "Currently airing on Bandcamp Radio",
    })).toHaveTextContent("Night Drive");
    expect(getRadioChapterLocalLinks.mock.calls.length).toBeGreaterThan(
      initialMetadataReads,
    );
  });

  it("turns an empty session into a useful continuation choice", () => {
    const noOp = vi.fn();
    const onPlayRecommendation = vi.fn();
    const onAnotherRecommendation = vi.fn();
    renderNowPlaying(
      <NowPlayingView
        track={radioTrack}
        radioTimeline={radioTimeline}
        queue={[radioTrack]}
        currentIndex={0}
        playing={false}
        playbackClock={createPlaybackClock(radioTrack.duration)}
        duration={radioTrack.duration}
        volume={0.7}
        repeat="off"
        artwork={<span>Artwork</span>}
        airPlayAvailable={false}
        queueOpen={false}
        onBack={noOp}
        onToggle={noOp}
        onPrevious={noOp}
        onNext={noOp}
        canPrevious={false}
        canNext={false}
        onSeek={noOp}
        onVolume={noOp}
        onRepeat={noOp}
        onAirPlay={noOp}
        onArtist={noOp}
        onAlbum={noOp}
        onPlayQueueIndex={noOp}
        onRadioSeries={noOp}
        recommendation={{
          album: continuationAlbum,
          reason: "Another Ambient pick",
        }}
        recommendationArtwork={<span>Suggested artwork</span>}
        recommendationLoading={false}
        onPlayRecommendation={onPlayRecommendation}
        onAnotherRecommendation={onAnotherRecommendation}
      />,
    );

    expect(screen.getByText("Queue complete")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Keep listening" }))
      .toBeInTheDocument();
    expect(screen.getByText("Soft Focus")).toBeInTheDocument();
    expect(screen.getByText("Night Archive · Another Ambient pick"))
      .toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", {
      name: "Play something from Soft Focus",
    }));
    fireEvent.click(screen.getByRole("button", { name: "Another pick" }));
    expect(onPlayRecommendation).toHaveBeenCalledOnce();
    expect(onAnotherRecommendation).toHaveBeenCalledOnce();
  });
});
