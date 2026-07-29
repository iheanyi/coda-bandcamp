import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
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

  it("focuses the track heading and drives playback, queue, and bounded sliders", () => {
    const onBack = vi.fn();
    const onToggle = vi.fn();
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    const onSeek = vi.fn();
    const onVolume = vi.fn();
    const onRepeat = vi.fn();
    const noOp = vi.fn();
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
      />,
    );

    expect(screen.getByRole("heading", { name: "Kinrose" })).toHaveFocus();

    const transportIcon = (name: string) => {
      const icon = screen.getByRole("button", { name }).querySelector("svg");
      if (!icon) throw new Error(`Missing ${name} icon`);
      return icon;
    };
    expect(transportIcon("Repeat off")).toHaveClass("size-5");
    expect(transportIcon("Previous")).toHaveClass("size-6");
    expect(transportIcon("Pause")).toHaveClass("size-7");
    expect(transportIcon("Next")).toHaveClass("size-6");
    expect(transportIcon("Show queue")).toHaveClass("size-5");
    expect(transportIcon("Mute")).toHaveClass("size-5");

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
    position.focus();
    fireEvent.keyDown(position, { key: "ArrowRight" });
    expect(onSeek).toHaveBeenCalledWith(46);
    fireEvent.keyDown(position, { key: "End" });
    expect(onSeek).toHaveBeenCalledWith(radioTrack.duration);
    fireEvent.keyDown(position, { key: "Home" });
    expect(onSeek).toHaveBeenCalledWith(0);

    const positionGroup = screen.getByRole("group", {
      name: "Now playing position",
    });
    const positionControl = positionGroup.querySelector<HTMLElement>(
      "[data-base-ui-slider-control]",
    );
    if (!positionControl) throw new Error("Missing position slider control");
    const positionThumb = positionGroup.querySelector<HTMLElement>(
      "[data-slot=slider-thumb]",
    );
    if (!positionThumb) throw new Error("Missing position slider thumb");
    vi.spyOn(positionControl, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(0, 0, 100, 20));
    vi.spyOn(positionThumb, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(0.82, 5, 10, 10));
    fireEvent.pointerDown(positionControl, {
      button: 0,
      buttons: 1,
      clientX: 50,
      clientY: 10,
      pointerId: 1,
      pointerType: "mouse",
    });
    expect(onSeek).toHaveBeenCalledWith(2469);
    fireEvent.pointerUp(document, {
      button: 0,
      buttons: 0,
      clientX: 50,
      clientY: 10,
      pointerId: 1,
      pointerType: "mouse",
    });

    const volumeGroup = screen.getByRole("group", { name: "Volume" });
    const volumeControl = volumeGroup.querySelector<HTMLElement>(
      "[data-base-ui-slider-control]",
    );
    if (!volumeControl) throw new Error("Missing volume slider control");
    const volumeThumb = volumeGroup.querySelector<HTMLElement>(
      "[data-slot=slider-thumb]",
    );
    if (!volumeThumb) throw new Error("Missing volume slider thumb");
    vi.spyOn(volumeControl, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(0, 0, 100, 20));
    vi.spyOn(volumeThumb, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(63, 5, 10, 10));
    fireEvent.pointerDown(volumeControl, {
      button: 0,
      buttons: 1,
      clientX: 36.5,
      clientY: 10,
      pointerId: 1,
      pointerType: "mouse",
    });
    expect(onVolume).toHaveBeenCalledWith(0.35);
    fireEvent.pointerUp(document, {
      button: 0,
      buttons: 0,
      clientX: 36.5,
      clientY: 10,
      pointerId: 1,
      pointerType: "mouse",
    });

    onVolume.mockClear();
    fireEvent.pointerDown(volumeControl, {
      button: 0,
      buttons: 1,
      clientX: 72,
      clientY: 10,
      pointerId: 1,
      pointerType: "mouse",
    });
    fireEvent.pointerMove(document, {
      buttons: 1,
      clientX: 35,
      clientY: 10,
      pointerId: 1,
      pointerType: "mouse",
    });
    fireEvent.pointerUp(document, {
      button: 0,
      buttons: 0,
      clientX: 35,
      clientY: 10,
      pointerId: 1,
      pointerType: "mouse",
    });
    expect(onVolume).toHaveBeenCalledWith(0.33);

    volume.focus();
    fireEvent.keyDown(volume, { key: "ArrowRight" });
    expect(onVolume).toHaveBeenCalledWith(0.71);
    fireEvent.keyDown(volume, { key: "End" });
    expect(onVolume).toHaveBeenCalledWith(1);
    fireEvent.keyDown(volume, { key: "Home" });
    expect(onVolume).toHaveBeenCalledWith(0);
  });

  it("reports continuous bounded seek changes while pointer-dragging the position slider", () => {
    const onSeek = vi.fn();
    const noOp = vi.fn();
    renderNowPlaying(
      <NowPlayingView
        track={radioTrack}
        radioTimeline={radioTimeline}
        queue={[radioTrack]}
        currentIndex={0}
        playing
        playbackClock={createPlaybackClock(42)}
        duration={180}
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
        onRadioSeries={noOp}
        recommendationLoading={false}
        onPlayRecommendation={noOp}
        onAnotherRecommendation={noOp}
      />,
    );

    const position = screen.getByRole("group", {
      name: "Now playing position",
    });
    const control = position.querySelector<HTMLElement>(
      "[data-base-ui-slider-control]",
    );
    if (!control) throw new Error("Missing position slider control");
    const thumb = position.querySelector<HTMLElement>(
      "[data-slot=slider-thumb]",
    );
    if (!thumb) throw new Error("Missing position slider thumb");
    vi.spyOn(control, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 100, 20),
    );
    vi.spyOn(thumb, "getBoundingClientRect").mockReturnValue(
      new DOMRect(21, 5, 10, 10),
    );

    fireEvent.pointerDown(control, {
      button: 0,
      buttons: 1,
      clientX: 35,
      clientY: 10,
      pointerId: 1,
      pointerType: "mouse",
    });
    fireEvent.pointerMove(document, {
      buttons: 1,
      clientX: 72.5,
      clientY: 10,
      pointerId: 1,
      pointerType: "mouse",
    });
    fireEvent.pointerMove(document, {
      buttons: 1,
      clientX: 120,
      clientY: 10,
      pointerId: 1,
      pointerType: "mouse",
    });
    fireEvent.pointerUp(document, {
      button: 0,
      buttons: 0,
      clientX: 120,
      clientY: 10,
      pointerId: 1,
      pointerType: "mouse",
    });

    expect(onSeek.mock.calls.map(([positionSeconds]) => positionSeconds))
      .toEqual([60, 135, 180]);
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

    fireEvent.click(currentTitle);
    expect(mocks.openBandcampUrl).toHaveBeenCalledWith(
      "https://sweepsbeats.bandcamp.com/track/mirage-w-keylime",
    );

    fireEvent.click(within(chapterList).getByRole("button", {
      name: "Open artist Sweeps on Bandcamp",
    }));
    fireEvent.click(within(chapterList).getByRole("button", {
      name: "Open album Mirage on Bandcamp",
    }));
    expect(mocks.openBandcampUrl).toHaveBeenCalledWith(
      "https://sweepsbeats.bandcamp.com/",
    );
    expect(mocks.openBandcampUrl).toHaveBeenCalledWith(
      "https://sweepsbeats.bandcamp.com/album/mirage",
    );
    expect(document.querySelector('img[src="https://f4.bcbits.com/img/0161226005_10.jpg"]')).toHaveAttribute(
      "src",
      "https://f4.bcbits.com/img/0161226005_10.jpg",
    );
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
