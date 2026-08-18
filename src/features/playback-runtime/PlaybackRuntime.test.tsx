import {
  act,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  PlayerStateSnapshot,
  Track,
} from "@/types";

import {
  album,
  controllerFrom,
  deferred,
  dispatchSystemMediaControl,
  mediaSession,
  mocks,
  persistedTrack,
  playerState,
  refreshedRadioShow,
  renderRuntime,
  systemMediaControlListenerCount,
  tracks,
} from "./playbackRuntimeTestHarness";

describe("Playback runtime", () => {
  it("keeps Now Playing while clearing, handles rapid transport, and persists no signed data", async () => {
    const { current } = renderRuntime({
      connected: true,
      lastFmConnected: false,
      persistenceTiming: {
        structuralSaveDebounceMs: 0,
        checkpointIntervalMs: 60_000,
      },
    });

    await waitFor(() => expect(controllerFrom(current).queue.ready).toBe(true));
    await waitFor(() => expect(mocks.savePlayerState).toHaveBeenCalled());
    mocks.savePlayerState.mockClear();

    act(() => controllerFrom(current).queueCommands.playTracks(tracks));
    act(() => {
      controllerFrom(current).transportCommands.next();
      controllerFrom(current).transportCommands.next();
    });
    expect(controllerFrom(current).queue.currentTrack?.id).toBe("track-2");
    expect(controllerFrom(current).queue.currentIndex).toBe(1);

    act(() => controllerFrom(current).queueCommands.clearQueue());
    expect(
      controllerFrom(current).queue.queue.map((track) => track.id),
    ).toEqual(["track-2"]);
    expect(controllerFrom(current).transport.playing).toBe(true);

    act(() => controllerFrom(current).queueCommands.playTrack(tracks[0]));
    await waitFor(() => expect(mocks.savePlayerState).toHaveBeenCalled());
    const saved = mocks.savePlayerState.mock.calls.at(-1)?.[0];
    expect(saved?.queue).toHaveLength(2);
    expect(saved?.queue[1]).toEqual({
      id: "track-1",
      title: "First Light",
      artist: "Night Archive",
      album: "Soft Focus",
      albumId: "album-1",
      duration: 100,
      track: 1,
      palette: ["#777", "#222"],
    });
    expect(saved?.queue[1]).not.toHaveProperty("streamUrl");
    expect(saved?.queue[1]).not.toHaveProperty("artworkUrl");
    expect(saved?.queue[1]).not.toHaveProperty("radioChapters");
    expect(saved?.queue[1]).not.toHaveProperty("musicBrainzId");
    expect(screen.getByTestId("playback-probe")).toHaveAttribute(
      "data-queue-length",
      "2",
    );
    const contextProjection = screen
      .getByTestId("playback-probe")
      .getAttribute("data-queue-status");
    expect(JSON.parse(contextProjection ?? "null")).toEqual({
      currentIndex: 1,
      currentTrackId: "track-1",
      currentAlbumId: "album-1",
      length: 2,
      open: false,
      ready: true,
      hasDeferredTracks: false,
    });
    expect(contextProjection).not.toContain("signature=private");
    const publicTrack = controllerFrom(current).queue.currentTrack;
    expect(publicTrack).not.toHaveProperty("streamUrl");
    expect(publicTrack?.artworkUrl).toContain("signature=private");
    expect(publicTrack?.radioChapters?.[0].artworkUrl).toContain(
      "signature=private",
    );
    expect(publicTrack?.discoverRelease?.artworkUrl).toContain(
      "signature=private",
    );
    expect(publicTrack?.discoverRelease?.featuredTrack).toBeUndefined();
  });

  it("binds rapid transport to the final track stream before requesting play", async () => {
    const interruptedPlay = deferred<void>();
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    play
      .mockReset()
      .mockReturnValueOnce(interruptedPlay.promise)
      .mockResolvedValue(undefined);
    const thirdTrack: Track = {
      ...tracks[1],
      id: "track-3",
      title: "Vanishing Point",
      track: 3,
      streamUrl: "https://t4.bcbits.com/stream/third.mp3?signature=private",
    };

    try {
      const { container, current } = renderRuntime({
        connected: true,
        lastFmConnected: false,
      });
      const audio = container.querySelector<HTMLAudioElement>("audio")!;
      await waitFor(() =>
        expect(controllerFrom(current).queue.ready).toBe(true),
      );

      act(() =>
        controllerFrom(current).queueCommands.playTracks([
          ...tracks,
          thirdTrack,
        ]),
      );
      await waitFor(() => expect(play).toHaveBeenCalledOnce());

      act(() => {
        controllerFrom(current).transportCommands.next();
        controllerFrom(current).transportCommands.next();
      });

      await waitFor(() => {
        expect(controllerFrom(current).queue.currentTrack?.id).toBe("track-3");
        expect(audio).toHaveAttribute("src", thirdTrack.streamUrl);
        expect(play).toHaveBeenCalledTimes(2);
      });
      await act(async () => {
        interruptedPlay.resolve();
        await interruptedPlay.promise;
      });
    } finally {
      play.mockReset().mockResolvedValue(undefined);
    }
  });

  it("ignores stale media events while a new track stream is unresolved", async () => {
    const nextStream = deferred<string>();
    mocks.fetchStreamUrl.mockImplementation((trackId) =>
      trackId === tracks[1].id
        ? nextStream.promise
        : Promise.resolve(`https://t4.bcbits.com/stream/${trackId}.mp3`),
    );
    const { streamUrl: _streamUrl, ...unresolvedSecondTrack } = tracks[1];
    const thirdTrack: Track = {
      ...tracks[1],
      id: "track-3",
      title: "Vanishing Point",
      track: 3,
      streamUrl: "https://t4.bcbits.com/stream/third.mp3",
    };
    const { container, current } = renderRuntime({
      connected: true,
      lastFmConnected: true,
    });
    const audio = container.querySelector<HTMLAudioElement>("audio")!;
    await waitFor(() => expect(controllerFrom(current).queue.ready).toBe(true));

    act(() =>
      controllerFrom(current).queueCommands.playTracks([
        tracks[0],
        unresolvedSecondTrack,
        thirdTrack,
      ]),
    );
    await waitFor(() =>
      expect(audio).toHaveAttribute("src", tracks[0].streamUrl),
    );
    fireEvent.playing(audio);
    await waitFor(() =>
      expect(mocks.updateLastFmNowPlaying).toHaveBeenCalledOnce(),
    );

    act(() => {
      controllerFrom(current).transportCommands.next();
      fireEvent.playing(audio);
      fireEvent.ended(audio);
      audio.currentTime = 75;
      fireEvent.timeUpdate(audio);
    });

    expect(controllerFrom(current).queue.currentIndex).toBe(1);
    expect(controllerFrom(current).queue.currentTrack?.id).toBe(tracks[1].id);
    expect(controllerFrom(current).transport.playing).toBe(true);
    expect(controllerFrom(current).playbackClock.readExact()).toBe(0);
    expect(mocks.updateLastFmNowPlaying).toHaveBeenCalledOnce();
    expect(audio).not.toHaveAttribute("src");

    await act(async () => {
      nextStream.resolve("https://t4.bcbits.com/stream/track-2-refreshed.mp3");
      await nextStream.promise;
    });
    await waitFor(() =>
      expect(audio).toHaveAttribute(
        "src",
        "https://t4.bcbits.com/stream/track-2-refreshed.mp3",
      ),
    );
  });

  it("surfaces a sanitized reason when Last.fm cannot update Now Playing", async () => {
    mocks.updateLastFmNowPlaying.mockRejectedValueOnce(
      "Could not reach Last.fm: https://ws.audioscrobbler.com/2.0/ timed out",
    );
    const { container, current, notify } = renderRuntime({
      connected: true,
      lastFmConnected: true,
    });
    const audio = container.querySelector<HTMLAudioElement>("audio")!;
    await waitFor(() => expect(controllerFrom(current).queue.ready).toBe(true));

    act(() => controllerFrom(current).queueCommands.playTrack(tracks[0]));
    await waitFor(() => expect(audio).toHaveAttribute("src"));
    fireEvent.playing(audio);

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        "Last.fm could not update Now Playing: Could not reach Last.fm: [redacted URL] timed out",
        "bad",
      ),
    );
  });

  it("starts fresh same-track activations for playTrack and playTracks", async () => {
    const { container, current } = renderRuntime({
      connected: true,
      lastFmConnected: true,
    });
    const audio = container.querySelector<HTMLAudioElement>("audio")!;
    await waitFor(() => expect(controllerFrom(current).queue.ready).toBe(true));

    act(() => controllerFrom(current).queueCommands.playTrack(tracks[0]));
    await waitFor(() => expect(audio).toHaveAttribute("src"));
    fireEvent.playing(audio);
    await waitFor(() =>
      expect(mocks.updateLastFmNowPlaying).toHaveBeenCalledTimes(1),
    );
    for (let position = 10; position <= 50; position += 10) {
      audio.currentTime = position;
      fireEvent.timeUpdate(audio);
    }
    await waitFor(() =>
      expect(mocks.scrobbleLastFm).toHaveBeenCalledTimes(1),
    );

    act(() => controllerFrom(current).queueCommands.playTrack(tracks[0]));
    expect(audio.currentTime).toBe(0);
    fireEvent.playing(audio);
    await waitFor(() =>
      expect(mocks.updateLastFmNowPlaying).toHaveBeenCalledTimes(2),
    );
    for (let position = 10; position <= 50; position += 10) {
      audio.currentTime = position;
      fireEvent.timeUpdate(audio);
    }
    await waitFor(() =>
      expect(mocks.scrobbleLastFm).toHaveBeenCalledTimes(2),
    );

    audio.currentTime = 25;
    act(() => controllerFrom(current).queueCommands.playTracks(tracks));
    expect(audio.currentTime).toBe(0);
    fireEvent.playing(audio);
    await waitFor(() =>
      expect(mocks.updateLastFmNowPlaying).toHaveBeenCalledTimes(3),
    );
  });

  it("restarts repeat-one playback after natural completion", async () => {
    const restored = playerState([persistedTrack(tracks[0])], {
      repeatMode: "one",
    });
    mocks.loadPlayerState.mockResolvedValue(restored);
    const { container, current } = renderRuntime({
      connected: true,
      lastFmConnected: false,
    });
    const audio = container.querySelector<HTMLAudioElement>("audio")!;
    await waitFor(() => expect(audio).toHaveAttribute("src"));
    act(() => controllerFrom(current).transportCommands.play());
    await waitFor(() =>
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalled(),
    );
    vi.mocked(HTMLMediaElement.prototype.play).mockClear();

    audio.currentTime = 100;
    fireEvent.ended(audio);

    expect(audio.currentTime).toBe(0);
    expect(controllerFrom(current).transport.playing).toBe(true);
    await waitFor(() =>
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce(),
    );
  });

  it("starts a new activation when Play follows a completed track", async () => {
    mocks.loadPlayerState.mockResolvedValue(
      playerState([persistedTrack(tracks[0])]),
    );
    const { container, current } = renderRuntime({
      connected: true,
      lastFmConnected: false,
    });
    const audio = container.querySelector<HTMLAudioElement>("audio")!;
    await waitFor(() => expect(audio).toHaveAttribute("src"));
    act(() => controllerFrom(current).transportCommands.play());
    await waitFor(() =>
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalled(),
    );
    vi.mocked(HTMLMediaElement.prototype.play).mockClear();
    Object.defineProperty(audio, "ended", {
      configurable: true,
      value: true,
    });

    audio.currentTime = 100;
    fireEvent.ended(audio);
    expect(controllerFrom(current).transport.playing).toBe(false);
    act(() => controllerFrom(current).transportCommands.play());

    expect(audio.currentTime).toBe(0);
    expect(controllerFrom(current).transport.playing).toBe(true);
    await waitFor(() =>
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce(),
    );
  });

  it("ignores a restore that completes after the session is cleared", async () => {
    const restore = deferred<PlayerStateSnapshot | undefined>();
    mocks.loadPlayerState.mockImplementation(() => restore.promise);
    const { current } = renderRuntime({
      connected: true,
      lastFmConnected: false,
    });

    await waitFor(() =>
      expect(mocks.loadPlayerState).toHaveBeenCalledOnce(),
    );
    await act(async () => {
      await controllerFrom(current).sessionCommands.clear();
    });
    await act(async () => {
      restore.resolve(playerState([persistedTrack(tracks[0])]));
      await restore.promise;
      await Promise.resolve();
    });

    expect(controllerFrom(current).queue.queue).toEqual([]);
    expect(controllerFrom(current).queue.ready).toBe(false);
    expect(mocks.clearPlayerState).toHaveBeenCalledOnce();
  });

  it("restores paused and applies the playhead only after media metadata loads", async () => {
    const restored = playerState(
      [persistedTrack(tracks[0]), persistedTrack(tracks[1])],
      {
        currentIndex: 1,
        positionSeconds: 42,
        volume: 0.44,
        repeatMode: "one",
      },
    );
    mocks.loadPlayerState.mockResolvedValue(restored);
    const { container, current } = renderRuntime({
      connected: true,
      lastFmConnected: false,
    });

    await waitFor(() =>
      expect(controllerFrom(current).queue.currentTrack?.id).toBe("track-2"),
    );
    expect(controllerFrom(current).transport.playing).toBe(false);
    expect(controllerFrom(current).transport.volume).toBe(0.44);
    expect(controllerFrom(current).transport.repeat).toBe("one");
    const audio = container.querySelector<HTMLAudioElement>("audio");
    expect(audio).not.toBeNull();
    await waitFor(() => expect(audio).toHaveAttribute("src"));
    Object.defineProperty(audio!, "duration", {
      configurable: true,
      value: 210,
    });
    fireEvent.loadedMetadata(audio!);
    expect(audio!.currentTime).toBe(42);
    expect(controllerFrom(current).playbackClock.readExact()).toBe(42);
  });

  it("invalidates and retries one failed signed stream before stopping playback", async () => {
    mocks.loadPlayerState.mockResolvedValue(
      playerState([persistedTrack(tracks[0])]),
    );
    mocks.fetchStreamUrl
      .mockResolvedValueOnce("https://t4.bcbits.com/stream/expired.mp3")
      .mockResolvedValueOnce("https://t4.bcbits.com/stream/refreshed.mp3");
    const { container, current, notify } = renderRuntime({
      connected: true,
      lastFmConnected: false,
    });
    const audio = container.querySelector<HTMLAudioElement>("audio")!;

    await waitFor(() =>
      expect(audio).toHaveAttribute(
        "src",
        "https://t4.bcbits.com/stream/expired.mp3",
      ),
    );
    act(() => controllerFrom(current).transportCommands.play());
    await waitFor(() =>
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalled(),
    );
    expect(mocks.fetchStreamUrl).toHaveBeenCalledTimes(1);
    Object.defineProperty(audio, "error", {
      configurable: true,
      value: { code: 2 },
    });

    fireEvent.error(audio);
    await waitFor(() =>
      expect(audio).toHaveAttribute(
        "src",
        "https://t4.bcbits.com/stream/refreshed.mp3",
      ),
    );
    expect(controllerFrom(current).transport.playing).toBe(true);

    fireEvent.error(audio);
    await waitFor(() =>
      expect(controllerFrom(current).transport.playing).toBe(false),
    );
    expect(mocks.fetchStreamUrl).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledWith(
      "Coda lost the Bandcamp stream connection.",
      "bad",
    );
  });

  it("refreshes an expired Daily preview without using Subsonic", async () => {
    const dailyTrack: Track = {
      ...tracks[0],
      id: "daily:album-of-the-day:a42:101",
      albumId: "daily:album-of-the-day:a42",
      streamUrl: "https://t4.bcbits.com/stream/expired/m4a",
      dailySource: {
        articleSection: "album-of-the-day",
        articleSlug: "soft-focus-album-review",
        articleTitle: "Soft Focus",
        articleUrl:
          "https://daily.bandcamp.com/album-of-the-day/soft-focus-album-review",
        itemUrl: "https://night-archive.bandcamp.com/album/soft-focus",
        artistUrl: "https://night-archive.bandcamp.com",
      },
    };
    const refreshedStreamUrl = "https://t4.bcbits.com/stream/refreshed/m4a";
    mocks.fetchDailyArticle.mockResolvedValue({
      articleSection: "album-of-the-day",
      articleUrl:
        "https://daily.bandcamp.com/album-of-the-day/soft-focus-album-review",
      embeds: [
        {
          artist: "Night Archive",
          id: "daily:album-of-the-day:a42",
          itemUrl: "https://night-archive.bandcamp.com/album/soft-focus",
          title: "Soft Focus",
          tracks: [
            {
              album: "Soft Focus",
              albumId: "daily:album-of-the-day:a42",
              artist: "Night Archive",
              duration: 100,
              id: dailyTrack.id,
              streamUrl: refreshedStreamUrl,
              title: "First Light",
              track: 1,
            },
          ],
        },
      ],
      id: "album-of-the-day:soft-focus-album-review",
      slug: "soft-focus-album-review",
      title: "Soft Focus",
    });
    const { container, current } = renderRuntime({
      connected: false,
      lastFmConnected: false,
    });
    const audio = container.querySelector<HTMLAudioElement>("audio")!;

    await waitFor(() => expect(controllerFrom(current).queue.ready).toBe(true));
    act(() => controllerFrom(current).queueCommands.playTrack(dailyTrack));
    await waitFor(() =>
      expect(audio).toHaveAttribute("src", dailyTrack.streamUrl),
    );
    Object.defineProperty(audio, "error", {
      configurable: true,
      value: { code: 2 },
    });

    fireEvent.error(audio);

    await waitFor(() =>
      expect(audio).toHaveAttribute("src", refreshedStreamUrl),
    );
    expect(mocks.fetchDailyArticle).toHaveBeenCalledWith(
      "album-of-the-day",
      "soft-focus-album-review",
    );
    expect(mocks.fetchStreamUrl).not.toHaveBeenCalled();
  });

  it("scrobbles only genuine listened time after a seek", async () => {
    const { container, current } = renderRuntime({
      connected: true,
      lastFmConnected: true,
    });
    const audio = container.querySelector<HTMLAudioElement>("audio")!;
    await waitFor(() => expect(controllerFrom(current).queue.ready).toBe(true));
    act(() => controllerFrom(current).queueCommands.playTrack(tracks[0]));
    await waitFor(() => expect(audio).toHaveAttribute("src"));
    fireEvent.playing(audio);
    await waitFor(() =>
      expect(mocks.updateLastFmNowPlaying).toHaveBeenCalledOnce(),
    );

    audio.currentTime = 50;
    fireEvent.seeking(audio);
    fireEvent.timeUpdate(audio);
    expect(mocks.scrobbleLastFm).not.toHaveBeenCalled();

    for (let position = 60; position <= 100; position += 10) {
      audio.currentTime = position;
      fireEvent.timeUpdate(audio);
    }
    await waitFor(() =>
      expect(mocks.scrobbleLastFm).toHaveBeenCalledOnce(),
    );
    expect(mocks.scrobbleLastFm).toHaveBeenCalledWith(
      expect.objectContaining({
        artist: "Night Archive",
        title: "First Light",
        albumArtist: "Night Archive & Guests",
        musicBrainzId: "189002e7-3285-4e2e-92a3-7f6c30d407a2",
        chosenByUser: true,
      }),
      expect.any(Number),
    );
  });

  it("reacquires Radio media and scrobbles its chapter and natural completion separately", async () => {
    const radioTrack = persistedTrack({
      ...tracks[0],
      id: "radio:979",
      title: "The Coda Broadcast",
      artist: "Bandcamp Radio",
      album: "Bandcamp Weekly",
      albumId: "radio:979",
      duration: 3_600,
      track: 1,
    });
    mocks.loadPlayerState.mockResolvedValue(
      playerState([radioTrack], { positionSeconds: 60 }),
    );
    const { container, current } = renderRuntime({
      connected: false,
      lastFmConnected: true,
    });
    const audio = container.querySelector<HTMLAudioElement>("audio")!;

    await waitFor(() =>
      expect(audio).toHaveAttribute("src", refreshedRadioShow.streamUrl),
    );
    expect(mocks.fetchRadioShow).toHaveBeenCalledWith(979);
    expect(mocks.fetchStreamUrl).not.toHaveBeenCalled();
    expect(controllerFrom(current).queue.currentTrack).not.toHaveProperty(
      "streamUrl",
    );
    expect(controllerFrom(current).queue.currentTrack?.artworkUrl).toBe(
      refreshedRadioShow.artworkUrl,
    );
    expect(
      controllerFrom(current).queue.currentRadioTimeline[1]?.artworkUrl,
    ).toBe(refreshedRadioShow.chapters[1].artworkUrl);
    Object.defineProperty(audio, "duration", {
      configurable: true,
      value: 3_600,
    });
    fireEvent.loadedMetadata(audio);
    act(() => controllerFrom(current).transportCommands.play());
    fireEvent.playing(audio);
    await waitFor(() =>
      expect(mocks.updateLastFmNowPlaying).toHaveBeenCalledWith(
        expect.objectContaining({
          artist: "Night Archive",
          title: "Second signal",
          chosenByUser: false,
        }),
      ),
    );

    for (let position = 70; position <= 300; position += 10) {
      audio.currentTime = position;
      fireEvent.timeUpdate(audio);
    }
    await waitFor(() =>
      expect(mocks.scrobbleLastFm).toHaveBeenCalledTimes(1),
    );
    audio.currentTime = 3_600;
    fireEvent.ended(audio);
    await waitFor(() =>
      expect(mocks.scrobbleLastFm).toHaveBeenCalledTimes(2),
    );
    expect(mocks.scrobbleLastFm.mock.calls[0][0]).toMatchObject({
      artist: "Night Archive",
      title: "Second signal",
      chosenByUser: false,
    });
    expect(mocks.scrobbleLastFm.mock.calls[1][0]).toMatchObject({
      artist: "Bandcamp Radio",
      title: "The Coda Broadcast",
      chosenByUser: false,
    });
    expect(mocks.checkpointPlayerState).toHaveBeenCalled();
  });

  it("routes native play and bounded seek events through the transport seam", async () => {
    mocks.loadPlayerState.mockResolvedValue(
      playerState([persistedTrack(tracks[0])]),
    );
    const { container, current } = renderRuntime({
      connected: true,
      lastFmConnected: false,
    });
    const audio = container.querySelector<HTMLAudioElement>("audio")!;
    Object.defineProperty(audio, "duration", {
      configurable: true,
      value: 100,
    });
    await waitFor(() =>
      expect(systemMediaControlListenerCount()).toBeGreaterThan(0),
    );
    act(() => dispatchSystemMediaControl({ action: "play" }));
    expect(controllerFrom(current).transport.playing).toBe(true);
    act(() =>
      dispatchSystemMediaControl({ action: "seek", positionSeconds: 500 }),
    );
    expect(audio.currentTime).toBe(100);
    expect(controllerFrom(current).playbackClock.readExact()).toBe(100);
  });

  it("materializes progressive library shuffle through the same queue owner", async () => {
    const notify = vi.fn();
    const { current } = renderRuntime({
      connected: true,
      lastFmConnected: false,
      notify,
      progressiveShuffle: {
        connected: true,
        getConnectionGeneration: () => 0,
        loadAlbumTracks: async () => tracks,
        recoverAlbum: (candidate) => candidate,
        applyRecoveredAlbums: () => undefined,
      },
    });
    await waitFor(() => expect(controllerFrom(current).queue.ready).toBe(true));

    act(() => controllerFrom(current).shuffle.shuffle([album], "collection"));

    await waitFor(() =>
      expect(controllerFrom(current).queue.queue).toHaveLength(2),
    );
    expect(controllerFrom(current).transport.playing).toBe(true);
    expect(controllerFrom(current).shuffle.hasMore).toBe(false);
    expect(notify).toHaveBeenCalledWith("Shuffling collection", "good");
  });

  it("keeps media-time updates out of the queue and transport Contexts", async () => {
    mocks.loadPlayerState.mockResolvedValue(
      playerState([persistedTrack(tracks[0])]),
    );
    const { container, current } = renderRuntime({
      connected: true,
      lastFmConnected: false,
    });
    const audio = container.querySelector<HTMLAudioElement>("audio")!;
    await waitFor(() => expect(audio).toHaveAttribute("src"));
    act(() => controllerFrom(current).transportCommands.play());
    const probe = screen.getByTestId("playback-probe");
    const renderCount = probe.dataset.renderCount;

    for (let position = 1; position <= 12; position += 1) {
      audio.currentTime = position;
      fireEvent.timeUpdate(audio);
    }

    expect(probe).toHaveAttribute("data-render-count", renderCount);
    expect(controllerFrom(current).playbackClock.readExact()).toBe(12);
  });

  it("generates fallback system artwork only during browser idle time", async () => {
    let scheduledArtwork: (() => void) | undefined;
    const requestIdleCallback = vi.fn((callback: () => void) => {
      scheduledArtwork = callback;
      return 23;
    });
    const cancelIdleCallback = vi.fn();
    const requestIdleDescriptor = Object.getOwnPropertyDescriptor(
      window,
      "requestIdleCallback",
    );
    const cancelIdleDescriptor = Object.getOwnPropertyDescriptor(
      window,
      "cancelIdleCallback",
    );
    Object.defineProperty(window, "requestIdleCallback", {
      configurable: true,
      value: requestIdleCallback,
    });
    Object.defineProperty(window, "cancelIdleCallback", {
      configurable: true,
      value: cancelIdleCallback,
    });
    const canvasContext = {
      createLinearGradient: () => ({ addColorStop: () => undefined }),
      fillRect: () => undefined,
      fillText: () => undefined,
      fillStyle: "",
      font: "",
      textBaseline: "",
    };
    const originalGetContext = Object.getOwnPropertyDescriptor(
      HTMLCanvasElement.prototype,
      "getContext",
    );
    const originalToDataURL = Object.getOwnPropertyDescriptor(
      HTMLCanvasElement.prototype,
      "toDataURL",
    );
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: vi.fn(() => canvasContext),
    });
    const toDataURL = vi.fn(() => "data:image/png;base64,Y29kYS1jb3Zlcg==");
    Object.defineProperty(HTMLCanvasElement.prototype, "toDataURL", {
      configurable: true,
      value: toDataURL,
    });
    let unmount: (() => void) | undefined;

    try {
      const view = renderRuntime({
        connected: true,
        lastFmConnected: false,
      });
      unmount = view.unmount;
      await waitFor(() =>
        expect(controllerFrom(view.current).queue.ready).toBe(true),
      );
      act(() =>
        controllerFrom(view.current).queueCommands.playTrack(tracks[1]),
      );

      await waitFor(() => expect(requestIdleCallback).toHaveBeenCalledOnce());
      expect(requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), {
        timeout: 250,
      });
      expect(mediaSession.metadata?.init.artwork).toBeUndefined();
      expect(toDataURL).not.toHaveBeenCalled();

      act(() => scheduledArtwork?.());

      expect(mediaSession.metadata?.init).toEqual(
        expect.objectContaining({
          title: tracks[1].title,
          artist: tracks[1].artist,
          artwork: [
            {
              src: "data:image/png;base64,Y29kYS1jb3Zlcg==",
              sizes: "600x600",
              type: "image/png",
            },
          ],
        }),
      );
      expect(toDataURL).toHaveBeenCalledOnce();

      unmount();
      unmount = undefined;
      expect(cancelIdleCallback).toHaveBeenCalledWith(23);
      act(() => scheduledArtwork?.());
      expect(toDataURL).toHaveBeenCalledOnce();
    } finally {
      unmount?.();
      if (originalGetContext) {
        Object.defineProperty(
          HTMLCanvasElement.prototype,
          "getContext",
          originalGetContext,
        );
      }
      if (originalToDataURL) {
        Object.defineProperty(
          HTMLCanvasElement.prototype,
          "toDataURL",
          originalToDataURL,
        );
      }
      if (requestIdleDescriptor) {
        Object.defineProperty(
          window,
          "requestIdleCallback",
          requestIdleDescriptor,
        );
      } else {
        Reflect.deleteProperty(window, "requestIdleCallback");
      }
      if (cancelIdleDescriptor) {
        Object.defineProperty(
          window,
          "cancelIdleCallback",
          cancelIdleDescriptor,
        );
      } else {
        Reflect.deleteProperty(window, "cancelIdleCallback");
      }
    }
  });

  it("uses local cover sources in the browser and cover IDs in native media", async () => {
    const view = renderRuntime({
      connected: true,
      lastFmConnected: false,
    });
    await waitFor(() =>
      expect(controllerFrom(view.current).queue.ready).toBe(true),
    );
    const coveredTrack: Track = {
      ...tracks[1],
      coverArt: "ca:496796527",
    };

    act(() =>
      controllerFrom(view.current).queueCommands.playTrack(coveredTrack),
    );

    await waitFor(() =>
      expect(mediaSession.metadata?.init.artwork?.[0]?.src).toMatch(
        /^coda-cover:\/v1\/600\/ca%3A496796527\?v=0&s=[a-f0-9]{32}$/u,
      ),
    );
    expect(mocks.updateSystemMediaMetadata).toHaveBeenLastCalledWith(
      expect.objectContaining({
        artwork: { kind: "cover", coverArtId: "ca:496796527" },
      }),
    );
  });
});
