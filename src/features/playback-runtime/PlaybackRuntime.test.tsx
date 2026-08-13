import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  Album,
  LastFmTrackInput,
  PlayerStateCheckpoint,
  PlayerStateInput,
  PlayerStateSnapshot,
  RadioShow,
  Track,
} from "@/types";

import { PlaybackRuntimeProvider } from "./PlaybackRuntimeProvider";
import {
  usePlaybackQueueStatus,
  usePlaybackTransportModel,
} from "./playbackRuntimeContext";
import { collectDesktopListenerCleanup } from "./adapters";
import { safePlaybackErrorDetail } from "./errors";
import type {
  DesktopPlaybackControlHandlers,
  PlaybackRuntimeAdapters,
  PlaybackRuntimeController,
  PlaybackRuntimeOptions,
  PlaybackSystemMediaAdapters,
} from "./types";
import { usePlaybackRuntimeController } from "./usePlaybackRuntimeController";

const tracks: Track[] = [
  {
    id: "track-1",
    title: "First Light",
    artist: "Night Archive",
    album: "Soft Focus",
    albumId: "album-1",
    duration: 100,
    track: 1,
    streamUrl: "https://example.test/first.mp3?signature=private",
    artworkUrl: "https://example.test/first.jpg?signature=private",
    albumArtist: "Night Archive & Guests",
    musicBrainzId: "189002e7-3285-4e2e-92a3-7f6c30d407a2",
    radioChapters: [
      {
        title: "Should not persist",
        artist: "Private",
        timecode: 0,
        artworkUrl: "https://example.test/chapter.jpg?signature=private",
      },
    ],
    discoverRelease: {
      id: "release-1",
      title: "Soft Focus",
      artist: "Night Archive",
      itemUrl: "https://night-archive.bandcamp.com/album/soft-focus",
      artworkUrl: "https://example.test/discover.jpg?signature=private",
      featuredTrack: {
        id: "track-1",
        title: "First Light",
        duration: 100,
        streamUrl: "https://example.test/discover.mp3?signature=private",
      },
    },
    palette: ["#777", "#222"],
  },
  {
    id: "track-2",
    title: "Afterimage",
    artist: "Night Archive",
    album: "Soft Focus",
    albumId: "album-1",
    duration: 210,
    track: 2,
    streamUrl: "https://example.test/after.mp3?signature=private",
    palette: ["#777", "#222"],
  },
];

const album: Album = {
  id: "album-1",
  title: "Soft Focus",
  artist: "Night Archive",
  songCount: tracks.length,
  duration: tracks.reduce((total, track) => total + track.duration, 0),
  palette: ["#777", "#222"],
};

const refreshedRadioShow: RadioShow = {
  id: 979,
  subtitle: "The Coda Broadcast",
  title: "Bandcamp Weekly",
  description: "A broadcast from Bandcamp.",
  publishedAt: "2026-07-20T12:00:00Z",
  duration: 3_600,
  streamUrl: "https://example.test/radio-979-refreshed.mp3",
  artworkUrl: "https://example.test/radio-979.jpg?signature=private",
  chapters: [
    { title: "Opening signal", artist: "Bandcamp Radio", timecode: 0 },
    {
      title: "Second signal",
      artist: "Night Archive",
      album: "Night Signals",
      timecode: 60,
      artworkUrl: "https://example.test/chapter-2.jpg?signature=private",
    },
  ],
};

function persistedTrack(track: Track): PlayerStateSnapshot["queue"][number] {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    albumId: track.albumId,
    duration: track.duration,
    track: track.track,
    palette: track.palette,
  };
}

function playerState(
  queue: PlayerStateSnapshot["queue"],
  overrides: Partial<PlayerStateSnapshot> = {},
): PlayerStateSnapshot {
  return {
    version: 1,
    savedAt: Date.now(),
    queue,
    currentIndex: 0,
    positionSeconds: 0,
    volume: 0.72,
    repeatMode: "off",
    queueOpen: false,
    ...overrides,
  };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createAdapterHarness(
  load: () => Promise<PlayerStateSnapshot | undefined> = async () => undefined,
) {
  const desktopHandlers: {
    current?: DesktopPlaybackControlHandlers;
  } = {};
  const persistence = {
    load: vi.fn(load),
    save: vi.fn(async (_input: PlayerStateInput) => undefined),
    checkpoint: vi.fn(async (_input: PlayerStateCheckpoint) => true),
    clear: vi.fn(async () => undefined),
  };
  const audio = {
    fetchStreamUrl: vi.fn(
      async (trackId: string) =>
        `https://example.test/${trackId}.mp3?signature=private`,
    ),
    invalidateStreamUrl: vi.fn(),
    loadDailyTrack: vi.fn(async (track: Track) => track),
    loadRadioShow: vi.fn(async () => refreshedRadioShow),
    recordDiagnostic: vi.fn(),
  };
  const scrobbling = {
    updateNowPlaying: vi.fn(async (_track: LastFmTrackInput) => undefined),
    scrobble: vi.fn(
      async (_track: LastFmTrackInput, _timestamp: number) => undefined,
    ),
    nowSeconds: vi.fn(() => 1_000),
  };
  const systemMedia = {
    coverArtSource: vi.fn(
      (coverArtId: string) =>
        `coda-cover://localhost/v1/600/${encodeURIComponent(coverArtId)}?v=0&s=0123456789abcdef0123456789abcdef`,
    ),
    createArtworkDataUrl: vi.fn<
      PlaybackSystemMediaAdapters["createArtworkDataUrl"]
    >(() => undefined),
    syncBrowserPlayback: vi.fn(),
    installBrowserHandlers: vi.fn(() => () => undefined),
    updateNativeMetadata: vi.fn(async () => undefined),
    updateNativePlayback: vi.fn(async () => undefined),
    updateNativeTimeline: vi.fn(async () => undefined),
    installDesktopControls: vi.fn(
      async (handlers: DesktopPlaybackControlHandlers) => {
        desktopHandlers.current = handlers;
        return () => {
          desktopHandlers.current = undefined;
        };
      },
    ),
  };
  const adapters: PlaybackRuntimeAdapters = {
    persistence,
    audio,
    scrobbling,
    systemMedia,
  };
  return {
    adapters,
    audio,
    desktopHandlers,
    persistence,
    scrobbling,
    systemMedia,
  };
}

function PlaybackProbe() {
  const queue = usePlaybackQueueStatus();
  const transport = usePlaybackTransportModel();
  const renderCount = useRef(0);
  renderCount.current += 1;
  return (
    <output
      data-testid="playback-probe"
      data-current-track={queue.currentTrackId ?? ""}
      data-playing={String(transport.playing)}
      data-queue-length={String(queue.length)}
      data-queue-status={JSON.stringify(queue)}
      data-ready={String(queue.ready)}
      data-render-count={String(renderCount.current)}
    />
  );
}

function renderRuntime(
  options: Omit<PlaybackRuntimeOptions, "albums" | "notify"> & {
    notify?: PlaybackRuntimeOptions["notify"];
  },
) {
  const current: { controller?: PlaybackRuntimeController } = {};
  const notify = options.notify ?? vi.fn();
  function Harness() {
    const controller = usePlaybackRuntimeController({
      ...options,
      albums: [],
      notify,
    });
    current.controller = controller;
    return (
      <PlaybackRuntimeProvider controller={controller}>
        <PlaybackProbe />
      </PlaybackRuntimeProvider>
    );
  }
  const view = render(<Harness />);
  return {
    ...view,
    current,
    notify,
  };
}

function controllerFrom(current: {
  controller?: PlaybackRuntimeController;
}): PlaybackRuntimeController {
  if (!current.controller) throw new Error("Playback controller is not ready");
  return current.controller;
}

beforeEach(() => {
  vi.mocked(HTMLMediaElement.prototype.play).mockClear();
  vi.mocked(HTMLMediaElement.prototype.pause).mockClear();
});

describe("Playback runtime", () => {
  it("keeps Now Playing while clearing, handles rapid transport, and persists no signed data", async () => {
    const harness = createAdapterHarness();
    const { current } = renderRuntime({
      connected: true,
      lastFmConnected: false,
      adapters: harness.adapters,
      persistenceTiming: {
        structuralSaveDebounceMs: 0,
        checkpointIntervalMs: 60_000,
      },
    });

    await waitFor(() => expect(controllerFrom(current).queue.ready).toBe(true));
    await waitFor(() => expect(harness.persistence.save).toHaveBeenCalled());
    harness.persistence.save.mockClear();

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
    await waitFor(() => expect(harness.persistence.save).toHaveBeenCalled());
    const saved = harness.persistence.save.mock.calls.at(-1)?.[0];
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
    const harness = createAdapterHarness();
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
      streamUrl: "https://example.test/third.mp3?signature=private",
    };

    try {
      const { container, current } = renderRuntime({
        connected: true,
        lastFmConnected: false,
        adapters: harness.adapters,
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
    const harness = createAdapterHarness();
    const nextStream = deferred<string>();
    harness.audio.fetchStreamUrl.mockImplementation((trackId) =>
      trackId === tracks[1].id
        ? nextStream.promise
        : Promise.resolve(`https://example.test/${trackId}.mp3`),
    );
    const { streamUrl: _streamUrl, ...unresolvedSecondTrack } = tracks[1];
    const thirdTrack: Track = {
      ...tracks[1],
      id: "track-3",
      title: "Vanishing Point",
      track: 3,
      streamUrl: "https://example.test/third.mp3",
    };
    const { container, current } = renderRuntime({
      connected: true,
      lastFmConnected: true,
      adapters: harness.adapters,
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
      expect(harness.scrobbling.updateNowPlaying).toHaveBeenCalledOnce(),
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
    expect(harness.scrobbling.updateNowPlaying).toHaveBeenCalledOnce();
    expect(audio).not.toHaveAttribute("src");

    await act(async () => {
      nextStream.resolve("https://example.test/track-2-refreshed.mp3");
      await nextStream.promise;
    });
    await waitFor(() =>
      expect(audio).toHaveAttribute(
        "src",
        "https://example.test/track-2-refreshed.mp3",
      ),
    );
  });

  it("starts fresh same-track activations for playTrack and playTracks", async () => {
    const harness = createAdapterHarness();
    const { container, current } = renderRuntime({
      connected: true,
      lastFmConnected: true,
      adapters: harness.adapters,
    });
    const audio = container.querySelector<HTMLAudioElement>("audio")!;
    await waitFor(() => expect(controllerFrom(current).queue.ready).toBe(true));

    act(() => controllerFrom(current).queueCommands.playTrack(tracks[0]));
    await waitFor(() => expect(audio).toHaveAttribute("src"));
    fireEvent.playing(audio);
    await waitFor(() =>
      expect(harness.scrobbling.updateNowPlaying).toHaveBeenCalledTimes(1),
    );
    for (let position = 10; position <= 50; position += 10) {
      audio.currentTime = position;
      fireEvent.timeUpdate(audio);
    }
    await waitFor(() =>
      expect(harness.scrobbling.scrobble).toHaveBeenCalledTimes(1),
    );

    act(() => controllerFrom(current).queueCommands.playTrack(tracks[0]));
    expect(audio.currentTime).toBe(0);
    fireEvent.playing(audio);
    await waitFor(() =>
      expect(harness.scrobbling.updateNowPlaying).toHaveBeenCalledTimes(2),
    );
    for (let position = 10; position <= 50; position += 10) {
      audio.currentTime = position;
      fireEvent.timeUpdate(audio);
    }
    await waitFor(() =>
      expect(harness.scrobbling.scrobble).toHaveBeenCalledTimes(2),
    );

    audio.currentTime = 25;
    act(() => controllerFrom(current).queueCommands.playTracks(tracks));
    expect(audio.currentTime).toBe(0);
    fireEvent.playing(audio);
    await waitFor(() =>
      expect(harness.scrobbling.updateNowPlaying).toHaveBeenCalledTimes(3),
    );
  });

  it("restarts repeat-one playback after natural completion", async () => {
    const restored = playerState([persistedTrack(tracks[0])], {
      repeatMode: "one",
    });
    const harness = createAdapterHarness(async () => restored);
    const { container, current } = renderRuntime({
      connected: true,
      lastFmConnected: false,
      adapters: harness.adapters,
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
    const harness = createAdapterHarness(async () =>
      playerState([persistedTrack(tracks[0])]),
    );
    const { container, current } = renderRuntime({
      connected: true,
      lastFmConnected: false,
      adapters: harness.adapters,
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
    const harness = createAdapterHarness(() => restore.promise);
    const { current } = renderRuntime({
      connected: true,
      lastFmConnected: false,
      adapters: harness.adapters,
    });

    await waitFor(() =>
      expect(harness.persistence.load).toHaveBeenCalledOnce(),
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
    expect(harness.persistence.clear).toHaveBeenCalledOnce();
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
    const harness = createAdapterHarness(async () => restored);
    const { container, current } = renderRuntime({
      connected: true,
      lastFmConnected: false,
      adapters: harness.adapters,
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
    const restored = playerState([persistedTrack(tracks[0])]);
    const harness = createAdapterHarness(async () => restored);
    harness.audio.fetchStreamUrl
      .mockResolvedValueOnce("https://example.test/expired.mp3")
      .mockResolvedValueOnce("https://example.test/refreshed.mp3");
    const { container, current, notify } = renderRuntime({
      connected: true,
      lastFmConnected: false,
      adapters: harness.adapters,
    });
    const audio = container.querySelector<HTMLAudioElement>("audio")!;

    await waitFor(() =>
      expect(audio).toHaveAttribute("src", "https://example.test/expired.mp3"),
    );
    act(() => controllerFrom(current).transportCommands.play());
    await waitFor(() =>
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalled(),
    );
    expect(harness.audio.fetchStreamUrl).toHaveBeenCalledTimes(1);
    Object.defineProperty(audio, "error", {
      configurable: true,
      value: { code: 2 },
    });

    fireEvent.error(audio);
    await waitFor(() =>
      expect(audio).toHaveAttribute(
        "src",
        "https://example.test/refreshed.mp3",
      ),
    );
    expect(harness.audio.invalidateStreamUrl).toHaveBeenCalledWith("track-1");
    expect(controllerFrom(current).transport.playing).toBe(true);

    fireEvent.error(audio);
    await waitFor(() =>
      expect(controllerFrom(current).transport.playing).toBe(false),
    );
    expect(harness.audio.fetchStreamUrl).toHaveBeenCalledTimes(2);
    expect(harness.audio.invalidateStreamUrl).toHaveBeenCalledTimes(1);
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
    const refreshedTrack = {
      ...dailyTrack,
      streamUrl: "https://t4.bcbits.com/stream/refreshed/m4a",
    };
    const harness = createAdapterHarness();
    harness.audio.loadDailyTrack.mockResolvedValue(refreshedTrack);
    const { container, current } = renderRuntime({
      connected: false,
      lastFmConnected: false,
      adapters: harness.adapters,
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
      expect(audio).toHaveAttribute("src", refreshedTrack.streamUrl),
    );
    expect(harness.audio.loadDailyTrack).toHaveBeenCalledWith(
      expect.objectContaining({
        id: dailyTrack.id,
        streamUrl: undefined,
      }),
    );
    expect(harness.audio.fetchStreamUrl).not.toHaveBeenCalled();
    expect(harness.audio.invalidateStreamUrl).not.toHaveBeenCalled();
  });

  it("scrobbles only genuine listened time after a seek", async () => {
    const harness = createAdapterHarness();
    const { container, current } = renderRuntime({
      connected: true,
      lastFmConnected: true,
      adapters: harness.adapters,
    });
    const audio = container.querySelector<HTMLAudioElement>("audio")!;
    await waitFor(() => expect(controllerFrom(current).queue.ready).toBe(true));
    act(() => controllerFrom(current).queueCommands.playTrack(tracks[0]));
    await waitFor(() => expect(audio).toHaveAttribute("src"));
    fireEvent.playing(audio);
    await waitFor(() =>
      expect(harness.scrobbling.updateNowPlaying).toHaveBeenCalledOnce(),
    );

    audio.currentTime = 50;
    fireEvent.seeking(audio);
    fireEvent.timeUpdate(audio);
    expect(harness.scrobbling.scrobble).not.toHaveBeenCalled();

    for (let position = 60; position <= 100; position += 10) {
      audio.currentTime = position;
      fireEvent.timeUpdate(audio);
    }
    await waitFor(() =>
      expect(harness.scrobbling.scrobble).toHaveBeenCalledOnce(),
    );
    expect(harness.scrobbling.scrobble).toHaveBeenCalledWith(
      expect.objectContaining({
        artist: "Night Archive",
        title: "First Light",
        albumArtist: "Night Archive & Guests",
        musicBrainzId: "189002e7-3285-4e2e-92a3-7f6c30d407a2",
        chosenByUser: true,
      }),
      1_000,
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
    const harness = createAdapterHarness(async () =>
      playerState([radioTrack], { positionSeconds: 60 }),
    );
    const { container, current } = renderRuntime({
      connected: false,
      lastFmConnected: true,
      adapters: harness.adapters,
    });
    const audio = container.querySelector<HTMLAudioElement>("audio")!;

    await waitFor(() =>
      expect(audio).toHaveAttribute("src", refreshedRadioShow.streamUrl),
    );
    expect(harness.audio.loadRadioShow).toHaveBeenCalledWith(979);
    expect(harness.audio.fetchStreamUrl).not.toHaveBeenCalled();
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
      expect(harness.scrobbling.updateNowPlaying).toHaveBeenCalledWith(
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
      expect(harness.scrobbling.scrobble).toHaveBeenCalledTimes(1),
    );
    audio.currentTime = 3_600;
    fireEvent.ended(audio);
    await waitFor(() =>
      expect(harness.scrobbling.scrobble).toHaveBeenCalledTimes(2),
    );
    expect(harness.scrobbling.scrobble.mock.calls[0][0]).toMatchObject({
      artist: "Night Archive",
      title: "Second signal",
      chosenByUser: false,
    });
    expect(harness.scrobbling.scrobble.mock.calls[1][0]).toMatchObject({
      artist: "Bandcamp Radio",
      title: "The Coda Broadcast",
      chosenByUser: false,
    });
    expect(harness.persistence.checkpoint).toHaveBeenCalled();
  });

  it("routes native play and bounded seek events through the transport seam", async () => {
    const harness = createAdapterHarness(async () =>
      playerState([persistedTrack(tracks[0])]),
    );
    const { container, current } = renderRuntime({
      connected: true,
      lastFmConnected: false,
      adapters: harness.adapters,
    });
    const audio = container.querySelector<HTMLAudioElement>("audio")!;
    Object.defineProperty(audio, "duration", {
      configurable: true,
      value: 100,
    });
    await waitFor(() => expect(harness.desktopHandlers.current).toBeDefined());
    act(() => harness.desktopHandlers.current?.onPlay());
    expect(controllerFrom(current).transport.playing).toBe(true);
    act(() => harness.desktopHandlers.current?.onSeek(500));
    expect(audio.currentTime).toBe(100);
    expect(controllerFrom(current).playbackClock.readExact()).toBe(100);
  });

  it("materializes progressive library shuffle through the same queue owner", async () => {
    const harness = createAdapterHarness();
    const notify = vi.fn();
    const { current } = renderRuntime({
      connected: true,
      lastFmConnected: false,
      adapters: harness.adapters,
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
    const harness = createAdapterHarness(async () =>
      playerState([persistedTrack(tracks[0])]),
    );
    const { container, current } = renderRuntime({
      connected: true,
      lastFmConnected: false,
      adapters: harness.adapters,
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
    const harness = createAdapterHarness();
    harness.systemMedia.createArtworkDataUrl.mockReturnValue(
      "data:image/png;base64,Y29kYS1jb3Zlcg==",
    );
    let unmount: (() => void) | undefined;

    try {
      const view = renderRuntime({
        connected: true,
        lastFmConnected: false,
        adapters: harness.adapters,
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
      expect(harness.systemMedia.createArtworkDataUrl).not.toHaveBeenCalled();

      act(() => scheduledArtwork?.());

      expect(
        harness.systemMedia.createArtworkDataUrl,
      ).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          title: tracks[1].title,
          artist: tracks[1].artist,
        }),
      );
      expect(harness.systemMedia.syncBrowserPlayback).toHaveBeenLastCalledWith(
        expect.objectContaining({
          artworkUrl: "data:image/png;base64,Y29kYS1jb3Zlcg==",
        }),
      );

      unmount();
      unmount = undefined;
      expect(cancelIdleCallback).toHaveBeenCalledWith(23);
      act(() => scheduledArtwork?.());
      expect(harness.systemMedia.createArtworkDataUrl).toHaveBeenCalledOnce();
    } finally {
      unmount?.();
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
    const harness = createAdapterHarness();
    const view = renderRuntime({
      connected: true,
      lastFmConnected: false,
      adapters: harness.adapters,
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

    const localSource =
      "coda-cover://localhost/v1/600/ca%3A496796527?v=0&s=0123456789abcdef0123456789abcdef";
    await waitFor(() =>
      expect(harness.systemMedia.syncBrowserPlayback).toHaveBeenLastCalledWith(
        expect.objectContaining({ artworkUrl: localSource }),
      ),
    );
    expect(harness.systemMedia.coverArtSource).toHaveBeenCalledWith(
      "ca:496796527",
    );
    expect(harness.systemMedia.updateNativeMetadata).toHaveBeenLastCalledWith(
      expect.objectContaining({
        artwork: { kind: "cover", coverArtId: "ca:496796527" },
      }),
    );
  });

  it("cleans up a native listener when its sibling registration fails", async () => {
    const dispose = vi.fn();
    await expect(
      collectDesktopListenerCleanup([
        Promise.resolve(dispose),
        Promise.reject(new Error("system media registration failed")),
      ]),
    ).rejects.toThrow("system media registration failed");
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("bounds and redacts playback failure details", () => {
    const detail = safePlaybackErrorDetail(
      new Error(
        `GET https://user:password@example.test/audio?token=private token=second Bearer third /Users/listener/Coda/private ${"x".repeat(400)}`,
      ),
    );
    expect(detail.length).toBeLessThanOrEqual(180);
    expect(detail).toContain("[redacted URL]");
    expect(detail).toContain("token=[redacted]");
    expect(detail).toContain("[redacted authorization]");
    expect(detail).toContain("[redacted path]");
    expect(detail).not.toMatch(/password|private|second|third|listener/iu);
  });
});
