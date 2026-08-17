import { QueryClient } from "@tanstack/react-query";
import { RouterContextProvider } from "@tanstack/react-router";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Drawer } from "@/components/ui/drawer";
import { resetDetailNavigation } from "@/detailNavigation";
import { createPlaybackClock } from "@/playbackClock";
import { boundRadioChapters } from "@/radioPlayback";
import { createCodaMemoryRouter } from "@/router";
import type { Album, Track } from "@/types";
import { NowPlayingView } from "./NowPlayingView";

const openBandcampUrl = vi.fn<(url: string) => Promise<void>>();

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
  const router = createCodaMemoryRouter(new QueryClient(), ["/now-playing"]);
  const rendered = render(ui, {
    wrapper: ({ children }) => (
      <RouterContextProvider router={router}>
        <Drawer>{children}</Drawer>
      </RouterContextProvider>
    ),
  });
  return { ...rendered, router };
}

function radioTimelineView(
  track: Track,
  timeline = boundRadioChapters(track.radioChapters ?? []),
) {
  const noOp = () => undefined;
  return (
    <NowPlayingView
      track={track}
      radioTimeline={timeline}
      queue={[track]}
      currentIndex={0}
      playing
      playbackClock={createPlaybackClock(0)}
      duration={track.duration}
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
      recommendationLoading={false}
      onPlayRecommendation={noOp}
      onAnotherRecommendation={noOp}
    />
  );
}

function linkLocation(link: HTMLElement) {
  const href = link.getAttribute("href");
  if (!href) throw new Error("Expected a semantic link href.");
  return new URL(href, "https://coda.local");
}

beforeEach(() => {
  resetDetailNavigation();
  openBandcampUrl.mockReset().mockResolvedValue(undefined);
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

    const albumLink = screen.getByRole("link", { name: "Soft Focus" });
    const albumLocation = linkLocation(albumLink);
    expect(albumLocation.pathname).toBe("/collection/albums/album-22");
    expect(Object.fromEntries(albumLocation.searchParams)).toEqual({
      genre: "All",
      mode: "releases",
      q: "",
      sort: "recent",
    });
    expect(
      within(screen.getByRole("heading", { name: "Static Bloom" })).getByText(
        "Static Bloom",
      ),
    ).toHaveAttribute("data-coda-now-playing-title-detail", libraryTrack.id);
    expect(
      screen.getByText("Artwork").closest("[data-coda-track-id]"),
    ).toHaveAttribute("data-coda-track-id", libraryTrack.id);
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

    const pendingAlbumLink = screen.getByRole("link", {
      name: "Loading album Soft Focus",
    });
    expect(pendingAlbumLink).toHaveAttribute("aria-disabled", "true");
    expect(pendingAlbumLink).toHaveAttribute("aria-busy", "true");
    expect(
      within(pendingAlbumLink).getByRole("status", {
        name: "Loading album Soft Focus",
      }),
    ).toBeInTheDocument();

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
    expect(
      within(currentTrack).getByRole("link", {
        name: trackWithoutRelease.artist,
      }),
    ).toBeInTheDocument();
    expect(
      within(currentTrack).queryByText("Soft Focus"),
    ).not.toBeInTheDocument();
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
    const detailSurface = radioHeading.closest(
      "[data-coda-now-playing-detail-surface]",
    );
    expect(detailSurface).toHaveAttribute(
      "data-coda-now-playing-detail-surface",
    );
    expect(detailSurface).not.toContainElement(
      screen.getByRole("button", { name: "Back" }),
    );
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
    expect(screen.getByRole("button", { name: "Show queue" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    const [position, volume] = screen.getAllByRole("slider", { hidden: true });
    expect(position).toHaveAttribute("aria-label", "Now playing position");
    expect(volume).toHaveAttribute("aria-label", "Volume");
    fireEvent.change(position, { target: { value: "46" } });
    expect(onSeek).toHaveBeenCalledWith(46);
    fireEvent.change(volume, { target: { value: "0.71" } });
    expect(onVolume).toHaveBeenCalledWith(0.71);

    rerender(view(true));
    expect(
      screen.queryByRole("group", { name: "Playback controls" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("slider", { name: "Volume" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Hide queue" }),
    ).not.toBeInTheDocument();
  });

  it("announces the currently airing chapter and safely links to the Radio show", async () => {
    const user = userEvent.setup();
    const noOp = vi.fn();
    const onAlbum = vi.fn();
    const onPlayQueueIndex = vi.fn();
    const onSeek = vi.fn();
    const onRadioSeries = vi.fn();
    const onToggle = vi.fn();
    const { container, router } = renderNowPlaying(
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
        onToggle={onToggle}
        onPrevious={noOp}
        onNext={noOp}
        canPrevious
        canNext
        onSeek={onSeek}
        onVolume={noOp}
        onRepeat={noOp}
        onAirPlay={noOp}
        onArtist={noOp}
        onAlbum={onAlbum}
        onPlayQueueIndex={onPlayQueueIndex}
        onRadioSeries={onRadioSeries}
        openExternal={openBandcampUrl}
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
    expect(currentlyAiring).toHaveTextContent(
      "Up next: Night Drive by Keylime",
    );
    expect(screen.getByRole("status")).toHaveTextContent("Playing now");

    const showLink = screen.getByRole("link", { name: "Kinrose" });
    expect(showLink).toHaveAttribute("href", "/radio/shows/979");
    expect(showLink).toHaveAttribute(
      "data-coda-now-playing-title-detail",
      radioTrack.id,
    );
    const preloadRoute = vi.spyOn(router, "preloadRoute");
    showLink.focus();
    expect(showLink).toHaveFocus();
    await waitFor(() => expect(preloadRoute).toHaveBeenCalledOnce());
    expect(preloadRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { showId: "979" },
        to: "/radio/shows/$showId",
      }),
    );
    await user.keyboard("{Enter}");
    expect(onAlbum).toHaveBeenCalledWith(radioTrack, showLink);
    expect(onToggle).not.toHaveBeenCalled();
    expect(onPlayQueueIndex).not.toHaveBeenCalled();
    expect(
      container.querySelector("a button, button a"),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open Kinrose on Bandcamp Radio",
      }),
    );
    expect(openBandcampUrl).toHaveBeenCalledWith(
      "https://bandcamp.com/radio?show=979",
    );
    const radioLink = screen.getByRole("link", { name: "Bandcamp Radio" });
    const seriesLink = screen.getByRole("link", { name: "The Hip Hop Show" });
    expect(radioLink).toHaveAttribute("href", "/radio");
    expect(seriesLink).toHaveAttribute("href", "/radio/series/5");
    fireEvent.click(radioLink);
    fireEvent.click(seriesLink);
    expect(onRadioSeries).toHaveBeenNthCalledWith(1, undefined, radioLink);
    expect(onRadioSeries).toHaveBeenNthCalledWith(2, 5, seriesLink);

    const chapterList = screen.getByRole("list", {
      name: "Radio chapter timeline",
    });
    const currentTitle = within(chapterList).getByRole("button", {
      name: "Open Mirage by Sweeps on Bandcamp",
    });
    expect(currentTitle.closest("li")).toHaveAttribute("aria-current", "true");
    expect(within(chapterList).getByText("Up next")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Seek to Mirage at 0:30",
      }),
    );
    expect(onSeek).toHaveBeenCalledWith(30);
  });

  it("bounds initial chapter work and resets the batch for a different show", () => {
    const longTrack: Track = {
      ...radioTrack,
      id: "radio:980",
      radioChapters: Array.from({ length: 20 }, (_, index) => ({
        artist: `Artist ${index + 1}`,
        timecode: index * 60,
        title: `Chapter ${index + 1}`,
      })),
    };
    const shortTrack: Track = {
      ...radioTrack,
      id: "radio:981",
    };
    const { rerender } = renderNowPlaying(radioTimelineView(longTrack));
    const longList = screen.getByRole("list", {
      name: "Radio chapter timeline",
    });

    expect(longList).toHaveAttribute("aria-busy", "true");
    expect(within(longList).getAllByRole("listitem")).toHaveLength(6);

    rerender(radioTimelineView(shortTrack));
    const shortList = screen.getByRole("list", {
      name: "Radio chapter timeline",
    });
    expect(shortList).not.toHaveAttribute("aria-busy");
    expect(within(shortList).getAllByRole("listitem")).toHaveLength(2);
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
    expect(getRadioChapterLocalLinks).toHaveBeenCalledTimes(
      initialMetadataReads,
    );

    act(() => playbackClock.updateFromMedia(120));
    expect(
      screen.getByRole("region", {
        name: "Currently airing on Bandcamp Radio",
      }),
    ).toHaveTextContent("Night Drive");
    expect(getRadioChapterLocalLinks.mock.calls.length).toBeGreaterThan(
      initialMetadataReads,
    );
  });

  it("splits Up Next playback from typed album and artist navigation", async () => {
    const nextTrack: Track = {
      ...libraryTrack,
      id: "track-23",
      title: "Afterimage",
      artist: "Glass Taxi",
      album: "City Limits",
      albumId: "album-23",
    };
    const onPlayQueueIndex = vi.fn();
    const onArtist = vi.fn();
    const onAlbum = vi.fn();
    const noOp = vi.fn();
    const { container, router } = renderNowPlaying(
      <NowPlayingView
        track={libraryTrack}
        radioTimeline={[]}
        queue={[libraryTrack, nextTrack]}
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
        onArtist={onArtist}
        onAlbum={onAlbum}
        onPlayQueueIndex={onPlayQueueIndex}
        onRadioSeries={noOp}
        recommendationLoading={false}
        onPlayRecommendation={noOp}
        onAnotherRecommendation={noOp}
      />,
    );
    const preloadRoute = vi.spyOn(router, "preloadRoute");
    const upNext = screen
      .getByRole("heading", { name: "Up next" })
      .closest("section");
    if (!upNext) throw new Error("Expected the Up Next section.");
    const scope = within(upNext);
    const playButton = scope.getByRole("button", { name: "Play Afterimage" });
    const artistLink = scope.getByRole("link", { name: "Glass Taxi" });
    const albumLink = scope.getByRole("link", { name: "City Limits" });

    const artistLocation = linkLocation(artistLink);
    expect(artistLocation.pathname).toBe("/collection/artists/glass%20taxi");
    expect(Object.fromEntries(artistLocation.searchParams)).toEqual({
      albumId: "album-23",
      genre: "All",
      mode: "artists",
      q: "",
      sort: "recent",
    });
    const albumLocation = linkLocation(albumLink);
    expect(albumLocation.pathname).toBe("/collection/albums/album-23");
    expect(Object.fromEntries(albumLocation.searchParams)).toEqual({
      genre: "All",
      mode: "releases",
      q: "",
      sort: "recent",
    });

    fireEvent.focus(albumLink);
    await waitFor(() => expect(preloadRoute).toHaveBeenCalledOnce());
    fireEvent.click(artistLink);
    fireEvent.click(albumLink);
    expect(onArtist).toHaveBeenCalledWith(
      nextTrack.artist,
      nextTrack.albumId,
      nextTrack,
      artistLink,
    );
    expect(onAlbum).toHaveBeenCalledWith(nextTrack, albumLink);
    expect(onPlayQueueIndex).not.toHaveBeenCalled();

    fireEvent.click(playButton);
    expect(onPlayQueueIndex).toHaveBeenCalledWith(1);
    expect(
      container.querySelector("a button, button a"),
    ).not.toBeInTheDocument();
  });

  it("turns an empty session into a useful continuation choice", () => {
    const noOp = vi.fn();
    const onQueueRecommendation = vi.fn();
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
        onQueueRecommendation={onQueueRecommendation}
        onPlayRecommendation={onPlayRecommendation}
        onAnotherRecommendation={onAnotherRecommendation}
      />,
    );

    expect(screen.getByText("Queue complete")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Keep listening" }),
    ).toBeInTheDocument();
    expect(
      linkLocation(screen.getByRole("link", { name: "Soft Focus" })).pathname,
    ).toBe("/collection/albums/album-22");
    expect(
      linkLocation(screen.getByRole("link", { name: "Night Archive" }))
        .pathname,
    ).toBe("/collection/artists/night%20archive");
    expect(screen.getByText(/Another Ambient pick/)).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Add Soft Focus to queue",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Play something from Soft Focus",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Another pick" }));
    expect(onQueueRecommendation).toHaveBeenCalledOnce();
    expect(onPlayRecommendation).toHaveBeenCalledOnce();
    expect(onAnotherRecommendation).toHaveBeenCalledOnce();
  });
});
