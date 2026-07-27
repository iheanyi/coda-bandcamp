import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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

describe("NowPlayingView Radio metadata", () => {
  it("announces the currently airing chapter and its successor", () => {
    const noOp = vi.fn();
    const onSeek = vi.fn();
    const onRadioSeries = vi.fn();
    render(
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
        onToggleQueue={noOp}
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
    expect(screen.getByText("Playing now").closest(".now-playing__status"))
      .toHaveClass("is-playing");

    const onAirTitle = within(currentlyAiring).getByRole("button", {
      name: "Open Mirage by Sweeps on Bandcamp",
    });
    fireEvent.click(onAirTitle);
    expect(mocks.openBandcampUrl).toHaveBeenCalledWith(
      "https://sweepsbeats.bandcamp.com/track/mirage-w-keylime",
    );

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

    const chapterList = document.querySelector(".now-playing__radio-chapters");
    expect(chapterList).not.toBeNull();
    const currentTitle = within(chapterList as HTMLElement).getByRole("button", {
      name: "Open Mirage by Sweeps on Bandcamp",
    });
    expect(currentTitle.closest("li")).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("Up next", { selector: ".now-playing__radio-state" }))
      .toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", {
      name: "Seek to Mirage at 0:30",
    }));
    expect(onSeek).toHaveBeenCalledWith(30);

    fireEvent.click(currentTitle);
    expect(mocks.openBandcampUrl).toHaveBeenCalledWith(
      "https://sweepsbeats.bandcamp.com/track/mirage-w-keylime",
    );

    fireEvent.click(within(chapterList as HTMLElement).getByRole("button", {
      name: "Open artist Sweeps on Bandcamp",
    }));
    fireEvent.click(within(chapterList as HTMLElement).getByRole("button", {
      name: "Open album Mirage on Bandcamp",
    }));
    expect(mocks.openBandcampUrl).toHaveBeenCalledWith(
      "https://sweepsbeats.bandcamp.com/",
    );
    expect(mocks.openBandcampUrl).toHaveBeenCalledWith(
      "https://sweepsbeats.bandcamp.com/album/mirage",
    );
    expect(document.querySelector(".radio-chapter-artwork img")).toHaveAttribute(
      "src",
      "https://f4.bcbits.com/img/0161226005_10.jpg",
    );
  });

  it("updates progress each second without rerendering Radio metadata inside a chapter", () => {
    const noOp = vi.fn();
    const playbackClock = createPlaybackClock(45);
    const getRadioChapterLocalLinks = vi.fn(() => ({}));
    render(
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
        onToggleQueue={noOp}
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

    expect(screen.getByLabelText("Now playing position")).toHaveValue("46");
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
    render(
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
        onToggleQueue={noOp}
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
    expect(document.querySelector(".now-playing__continuation-copy"))
      .toHaveTextContent("Night Archive · Another Ambient pick");

    fireEvent.click(screen.getByRole("button", {
      name: "Play something from Soft Focus",
    }));
    fireEvent.click(screen.getByRole("button", { name: "Another pick" }));
    expect(onPlayRecommendation).toHaveBeenCalledOnce();
    expect(onAnotherRecommendation).toHaveBeenCalledOnce();
  });
});
