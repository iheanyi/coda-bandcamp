import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { albumQueryKey } from "./libraryQueries";
import type { Album, Track } from "./types";
import { album, deferred, findAudioElement, mocks, renderApp, single, type TestMediaSession, tracks } from "./test/appTestHarness";

describe("Coda player transport flows", { timeout: 10_000 }, () => {

  it("plays an album, exposes native AirPlay, and preserves now playing when clearing", async () => {
    const airPlayPicker = vi.fn();
    Object.defineProperty(HTMLMediaElement.prototype, "webkitShowPlaybackTargetPicker", {
      configurable: true,
      value: airPlayPicker,
    });
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    const { container, queryClient } = renderApp(true);

    await screen.findByText("Soft Focus");
    const setQueryData = vi.spyOn(queryClient, "setQueryData");
    fireEvent.click(screen.getByRole("button", { name: "Play Soft Focus" }));

    expect(await screen.findByRole("link", { name: "Open Now Playing" }))
      .toBeInTheDocument();
    expect(setQueryData.mock.calls.filter(([queryKey]) =>
      Array.isArray(queryKey) && queryKey.join("/") === "bandcamp/library"
    )).toHaveLength(0);
    expect(screen.getAllByText("First Light").length).toBeGreaterThan(0);
    const player = screen.getByRole("contentinfo");
    const favorite = screen.getByRole("button", {
      name: "Add First Light to favorites",
    });
    expect(within(player).getByRole("button", {
      name: "Add First Light to favorites",
    })).toBe(favorite);
    expect(within(player).getByRole("slider", { name: "Volume" }))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose AirPlay device" }));
    expect(airPlayPicker).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Show queue" }));
    expect(await screen.findByText("Now playing")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear next" }));
    await waitFor(() => {
      expect(screen.getByText("End of the queue")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", {
      name: "Play something from Soft Focus",
    })).toBeInTheDocument();
    expect(screen.getByRole("button", {
      name: "Suggest another album",
    })).toBeInTheDocument();
    expect(screen.getAllByText("First Light").length).toBeGreaterThan(0);
    expect(screen.queryByText("Afterimage")).not.toBeInTheDocument();

    const audio = await findAudioElement(container);
    fireEvent.ended(audio);
    expect(await screen.findByRole("button", { name: "Play" })).toBeInTheDocument();

    vi.spyOn(Math, "random")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.75);
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    play.mockClear();
    fireEvent.click(screen.getByRole("button", {
      name: "Play something from Soft Focus",
    }));

    expect(await screen.findByRole("button", {
      name: "Add Afterimage to favorites",
    })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    await waitFor(() => {
      expect(audio).toHaveAttribute(
        "src",
        tracks[1].streamUrl,
      );
      expect(play).toHaveBeenCalled();
    });
  });

  it("adds a queue recommendation without interrupting playback and advances the suggestion", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album, single]);
    mocks.fetchAlbum.mockImplementation(async (requestedAlbum: Album) =>
      requestedAlbum.id === single.id ? single.tracks ?? [] : tracks);
    const { container } = renderApp();

    await screen.findByText("Soft Focus");
    fireEvent.click(screen.getByRole("button", { name: "Play Soft Focus" }));
    await screen.findByRole("link", { name: "Open Now Playing" });
    fireEvent.click(screen.getByRole("button", { name: "Show queue" }));
    const queueDialog = await screen.findByRole("dialog", { name: "Queue" });
    fireEvent.click(within(queueDialog).getByRole("button", {
      name: "Clear next",
    }));

    const audio = await findAudioElement(container);
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    const playbackCallsBeforeQueueing = play.mock.calls.length;
    expect(audio).toHaveAttribute("src", tracks[0].streamUrl);

    fireEvent.click(await within(queueDialog).findByRole("button", {
      name: "Add Streetlight to queue",
    }));

    expect(await within(queueDialog).findByRole("button", {
      name: "Streetlight",
    })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(audio).toHaveAttribute("src", tracks[0].streamUrl);
    expect(play).toHaveBeenCalledTimes(playbackCallsBeforeQueueing);
    expect(await within(queueDialog).findByRole("button", {
      name: "Add Soft Focus to queue",
    })).toBeInTheDocument();
  });

  it("routes compact-player position and volume changes into audio state", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    const restoredQueue = tracks.map(
      ({ streamUrl: _streamUrl, ...track }) => track,
    );
    mocks.loadPlayerState.mockResolvedValue({
      version: 1,
      savedAt: Date.now(),
      queue: restoredQueue,
      currentIndex: 0,
      positionSeconds: 42,
      volume: 0.44,
      repeatMode: "off",
      queueOpen: false,
    });
    const { container } = renderApp();

    await screen.findByRole("link", { name: "Open Now Playing" });
    const audio = container.querySelector("audio");
    expect(audio).not.toBeNull();
    await waitFor(() => expect(audio).toHaveAttribute("src"));
    Object.defineProperty(audio!, "duration", {
      configurable: true,
      value: 210,
    });
    fireEvent.loadedMetadata(audio!);
    await waitFor(() => expect(audio!.currentTime).toBe(42));
    await waitFor(() => expect(audio!.volume).toBeCloseTo(0.44));

    const position = screen.getByRole("slider", {
      name: "Track position",
    });
    position.focus();
    fireEvent.keyDown(position, { key: "ArrowRight" });
    await waitFor(() => expect(audio!.currentTime).toBe(43));

    const volume = screen.getByRole("slider", { name: "Volume" });
    volume.focus();
    fireEvent.keyDown(volume, { key: "ArrowRight" });
    await waitFor(() => expect(audio!.volume).toBeCloseTo(0.45));
  });

  it("omits the compact-player release label when metadata has no album name", async () => {
    const trackWithoutRelease = {
      ...tracks[0],
      album: "Unknown release",
    };
    mocks.loadPlayerState.mockResolvedValue({
      version: 1,
      savedAt: Date.now(),
      queue: [trackWithoutRelease],
      currentIndex: 0,
      positionSeconds: 0,
      volume: 0.72,
      repeatMode: "off",
      queueOpen: false,
    });

    renderApp();

    const player = await screen.findByRole("contentinfo");
    expect(within(player).getByRole("link", {
      name: trackWithoutRelease.artist,
    })).toBeInTheDocument();
    expect(
      player.querySelector("[data-player-album-link]"),
    ).not.toBeInTheDocument();
  });

  it("keeps the pending compact-player album action named", async () => {
    const longArtist =
      "Night Archive and the Extended Ensemble of Endless Echoes";
    const longAlbumTitle =
      "Soft Focus Across the Entire Unbroken Midnight Horizon";
    const longTrack = {
      ...tracks[0],
      artist: longArtist,
      album: longAlbumTitle,
    };
    const longAlbum = {
      ...album,
      title: longAlbumTitle,
      artist: longArtist,
      tracks: [longTrack],
      songCount: 1,
      duration: longTrack.duration,
    };
    const pendingAlbum = deferred<Track[]>();
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([longAlbum]);
    mocks.fetchAlbum
      .mockResolvedValueOnce([longTrack])
      .mockReturnValueOnce(pendingAlbum.promise);
    const { queryClient } = renderApp();

    try {
      await screen.findByText(longAlbumTitle);
      fireEvent.click(screen.getByRole("button", {
        name: `Play ${longAlbumTitle}`,
      }));
      const player = await screen.findByRole("contentinfo");
      const albumControl = within(player).getByRole("link", {
        name: longAlbumTitle,
      });

      queryClient.removeQueries({ queryKey: albumQueryKey(longAlbum.id) });
      fireEvent.click(albumControl);

      const pendingControl = await within(player).findByRole("link", {
        name: `Loading album ${longAlbumTitle}`,
      });
      expect(pendingControl).toHaveAttribute("aria-disabled", "true");
      expect(pendingControl).toHaveAttribute("aria-busy", "true");
      expect(within(pendingControl).getByRole("status", {
        name: `Loading album ${longAlbumTitle}`,
      })).toBeInTheDocument();
    } finally {
      pendingAlbum.resolve([longTrack]);
      await act(async () => {
        await Promise.resolve();
      });
    }
  });

  it("restarts with Previous near the track body and disables unavailable transport", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    mocks.loadPlayerState.mockResolvedValue({
      version: 1,
      savedAt: Date.now(),
      queue: tracks.map(({ streamUrl: _streamUrl, ...track }) => track),
      currentIndex: 0,
      positionSeconds: 0,
      volume: 0.72,
      repeatMode: "off",
      queueOpen: false,
    });
    const { container } = renderApp();

    await screen.findByRole("link", { name: "Open Now Playing" });

    const player = screen.getByRole("contentinfo");
    const previous = within(player).getByRole("button", { name: "Previous" });
    const next = within(player).getByRole("button", { name: "Next" });
    const audio = await findAudioElement(container);
    await waitFor(() => expect(audio).toHaveAttribute("src"));

    expect(previous).toBeDisabled();
    await waitFor(() => expect(next).toBeEnabled());

    audio.currentTime = 6;
    fireEvent.timeUpdate(audio);
    expect(previous).toBeEnabled();
    fireEvent.click(previous);

    expect(audio.currentTime).toBe(0);
    expect(within(player).getByText("First Light")).toBeInTheDocument();
    expect(previous).toBeDisabled();

    fireEvent.click(next);
    await waitFor(() =>
      expect(within(player).getByText("Afterimage")).toBeInTheDocument(),
    );
    expect(next).toBeDisabled();
    expect(previous).toBeEnabled();

    fireEvent.click(within(player!).getByRole("button", { name: "Repeat off" }));
    expect(next).toBeEnabled();
    fireEvent.click(next);
    expect(within(player).getByText("First Light")).toBeInTheDocument();
  });

  it("does not wrap rapid Next clicks when repeat is off", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    renderApp();

    await screen.findByText("Soft Focus");
    fireEvent.click(screen.getByRole("button", {
      name: "Play Soft Focus",
    }));
    const player = await screen.findByRole("contentinfo");
    const next = within(player).getByRole("button", { name: "Next" });

    act(() => {
      fireEvent.click(next);
      fireEvent.click(next);
    });

    await waitFor(() => {
      expect(within(player).getByText("Afterimage")).toBeInTheDocument();
      expect(next).toBeDisabled();
    });
  });

  it("does not wrap rapid Previous clicks when repeat is off", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    renderApp();

    await screen.findByText("Soft Focus");
    fireEvent.click(screen.getByRole("button", {
      name: "Play Soft Focus",
    }));
    const player = await screen.findByRole("contentinfo");
    fireEvent.click(within(player).getByRole("button", { name: "Next" }));
    await screen.findByText("Afterimage");

    const previous = within(player).getByRole("button", { name: "Previous" });
    act(() => {
      fireEvent.click(previous);
      fireEvent.click(previous);
    });

    await waitFor(() => {
      expect(within(player).getByText("First Light")).toBeInTheDocument();
      expect(previous).toBeDisabled();
    });
  });

  it("ignores an interrupted stale play request after rapid Next clicks", async () => {
    const rapidTracks: Track[] = [
      ...tracks,
      {
        id: "track-3",
        title: "Vanishing Point",
        artist: "Night Archive",
        album: "Soft Focus",
        albumId: "album-1",
        duration: 196,
        track: 3,
        streamUrl: "https://t4.bcbits.com/stream/vanishing-point/mp3-128",
        palette: ["#777", "#222"],
      },
    ];
    const interruptedPlay = deferred<void>();
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    play.mockReset()
      .mockReturnValueOnce(interruptedPlay.promise)
      .mockResolvedValue(undefined);

    try {
      mocks.hasConnection.mockResolvedValue(true);
      mocks.fetchLibrary.mockResolvedValue([{
        ...album,
        songCount: rapidTracks.length,
        tracks: rapidTracks,
      }]);
      mocks.fetchAlbum.mockResolvedValue(rapidTracks);
      renderApp();

      await screen.findByText("Soft Focus");
      fireEvent.click(screen.getByRole("button", {
        name: "Play Soft Focus",
      }));
      const player = await screen.findByRole("contentinfo");
      await waitFor(() => expect(play).toHaveBeenCalledOnce());

      const next = within(player).getByRole("button", { name: "Next" });
      act(() => {
        fireEvent.click(next);
        fireEvent.click(next);
      });
      await waitFor(() => {
        expect(within(player).getByText("Vanishing Point"))
          .toBeInTheDocument();
        expect(play).toHaveBeenCalledTimes(2);
      });

      await act(async () => {
        interruptedPlay.reject(
          new DOMException("The play request was interrupted", "AbortError"),
        );
        await Promise.resolve();
      });

      expect(within(player).getByRole("button", { name: "Pause" }))
        .toBeInTheDocument();
    } finally {
      play.mockReset().mockResolvedValue(undefined);
    }
  });

  it("keeps playing when an intermediate rapid Next request is interrupted", async () => {
    const rapidTracks: Track[] = [
      ...tracks,
      {
        id: "track-3",
        title: "Vanishing Point",
        artist: "Night Archive",
        album: "Soft Focus",
        albumId: "album-1",
        duration: 196,
        track: 3,
        streamUrl: "https://t4.bcbits.com/stream/vanishing-point/mp3-128",
        palette: ["#777", "#222"],
      },
    ];
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    play.mockReset()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        new DOMException("The play request was interrupted", "AbortError"),
      )
      .mockResolvedValue(undefined);

    try {
      mocks.hasConnection.mockResolvedValue(true);
      mocks.fetchLibrary.mockResolvedValue([{
        ...album,
        songCount: rapidTracks.length,
        tracks: rapidTracks,
      }]);
      mocks.fetchAlbum.mockResolvedValue(rapidTracks);
      renderApp();

      await screen.findByText("Soft Focus");
      fireEvent.click(screen.getByRole("button", {
        name: "Play Soft Focus",
      }));
      const player = await screen.findByRole("contentinfo");
      await waitFor(() => expect(play).toHaveBeenCalledOnce());

      const next = within(player).getByRole("button", { name: "Next" });
      fireEvent.click(next);
      await waitFor(() => expect(play).toHaveBeenCalledTimes(2));
      fireEvent.click(next);

      await waitFor(() => {
        expect(within(player).getByText("Vanishing Point"))
          .toBeInTheDocument();
        expect(within(player).getByRole("button", { name: "Pause" }))
          .toBeInTheDocument();
        expect(play).toHaveBeenCalledTimes(3);
      });
    } finally {
      play.mockReset().mockResolvedValue(undefined);
    }
  });

  it("publishes rich WebKit media state and routes next-track controls", async () => {
    class MockMediaMetadata {
      constructor(readonly init: MediaMetadataInit) {}
    }
    const handlers = new Map<
      MediaSessionAction,
      MediaSessionActionHandler | null
    >();
    const setActionHandler = vi.fn(
      (
        action: MediaSessionAction,
        handler: MediaSessionActionHandler | null,
      ) => {
        handlers.set(action, handler);
      },
    );
    const setPositionState = vi.fn();
    const mediaSession: TestMediaSession<MockMediaMetadata> = {
      metadata: null,
      playbackState: "none",
      setActionHandler,
      setPositionState,
    };
    const descriptor = Object.getOwnPropertyDescriptor(
      navigator,
      "mediaSession",
    );
    const metadataDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "MediaMetadata",
    );
    Object.defineProperty(navigator, "mediaSession", {
      configurable: true,
      value: mediaSession,
    });
    Object.defineProperty(globalThis, "MediaMetadata", {
      configurable: true,
      value: MockMediaMetadata,
    });
    mocks.loadPlayerState.mockResolvedValue({
      version: 1,
      savedAt: Date.now(),
      queue: tracks.map(({ streamUrl: _streamUrl, ...track }, index) =>
        index === 0 ? { ...track, coverArt: "ca:496796527" } : track
      ),
      currentIndex: 0,
      positionSeconds: 0,
      volume: 0.72,
      repeatMode: "off",
      queueOpen: false,
    });
    let unmount: (() => void) | undefined;

    try {
      const view = renderApp();
      unmount = view.unmount;
      await screen.findByRole("link", { name: "Open Now Playing" });

      expect(handlers.get("seekforward")).toBeNull();
      expect(
        setActionHandler.mock.calls.filter(
          ([action, handler]) =>
            action === "nexttrack" && handler !== null,
        ),
      ).toHaveLength(1);
      const skipTrack = handlers.get("nexttrack");
      expect(skipTrack).toBeTypeOf("function");
      await waitFor(() =>
        expect(mediaSession.metadata?.init).toEqual({
          title: "First Light",
          artist: "Night Archive",
          album: "Soft Focus",
          artwork: [{
            src: expect.stringMatching(
              /^coda-cover:\/v1\/600\/ca%3A496796527\?v=0&s=[a-f0-9]{32}$/u,
            ),
          }],
        }),
      );
      expect(setPositionState).toHaveBeenCalledWith({
        duration: 180,
        playbackRate: 1,
        position: 0,
      });
      act(() => skipTrack?.({ action: "nexttrack" }));

      const player = within(view.container).getByRole("contentinfo");
      await waitFor(() =>
        expect(within(player).getByText("Afterimage")).toBeInTheDocument(),
      );
    } finally {
      unmount?.();
      if (descriptor) {
        Object.defineProperty(navigator, "mediaSession", descriptor);
      } else {
        Reflect.deleteProperty(navigator, "mediaSession");
      }
      if (metadataDescriptor) {
        Object.defineProperty(
          globalThis,
          "MediaMetadata",
          metadataDescriptor,
        );
      } else {
        Reflect.deleteProperty(globalThis, "MediaMetadata");
      }
    }
  });

  it("generates fallback system artwork only after the browser is idle", async () => {
    let scheduledArtwork: (() => void) | undefined;
    const requestIdleCallback = vi.fn((callback: () => void) => {
      scheduledArtwork = callback;
      return 17;
    });
    const cancelIdleCallback = vi.fn();
    class MockMediaMetadata {
      constructor(readonly init: MediaMetadataInit) {}
    }
    const mediaSession: TestMediaSession<MockMediaMetadata> = {
      metadata: null,
      playbackState: "none",
      setActionHandler: vi.fn(),
      setPositionState: vi.fn(),
    };
    const requestIdleDescriptor = Object.getOwnPropertyDescriptor(
      window,
      "requestIdleCallback",
    );
    const cancelIdleDescriptor = Object.getOwnPropertyDescriptor(
      window,
      "cancelIdleCallback",
    );
    const mediaSessionDescriptor = Object.getOwnPropertyDescriptor(
      navigator,
      "mediaSession",
    );
    const metadataDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "MediaMetadata",
    );
    const getContextDescriptor = Object.getOwnPropertyDescriptor(
      HTMLCanvasElement.prototype,
      "getContext",
    );
    const toDataUrlDescriptor = Object.getOwnPropertyDescriptor(
      HTMLCanvasElement.prototype,
      "toDataURL",
    );
    const fillText = vi.fn();
    const getContext = vi.fn(() => ({
      createLinearGradient: () => ({ addColorStop: vi.fn() }),
      fillRect: vi.fn(),
      fillText,
    }));
    const toDataURL = vi.fn(
      () => "data:image/png;base64,Y29kYS1jb3Zlcg==",
    );
    Object.defineProperty(window, "requestIdleCallback", {
      configurable: true,
      value: requestIdleCallback,
    });
    Object.defineProperty(window, "cancelIdleCallback", {
      configurable: true,
      value: cancelIdleCallback,
    });
    Object.defineProperty(navigator, "mediaSession", {
      configurable: true,
      value: mediaSession,
    });
    Object.defineProperty(globalThis, "MediaMetadata", {
      configurable: true,
      value: MockMediaMetadata,
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: getContext,
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "toDataURL", {
      configurable: true,
      value: toDataURL,
    });
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    let unmount: (() => void) | undefined;

    try {
      const view = renderApp();
      unmount = view.unmount;
      await screen.findByText("Soft Focus");
      fireEvent.click(screen.getByRole("button", { name: "Play Soft Focus" }));

      await waitFor(() => expect(requestIdleCallback).toHaveBeenCalledOnce());
      expect(requestIdleCallback).toHaveBeenCalledWith(
        expect.any(Function),
        { timeout: 250 },
      );
      expect(getContext).not.toHaveBeenCalled();

      act(() => scheduledArtwork?.());

      expect(getContext).toHaveBeenCalledOnce();
      expect(fillText).toHaveBeenCalledWith("FL", 54, 144);
      expect(fillText).toHaveBeenCalledWith(
        "NIGHT ARCHIVE",
        54,
        552,
        492,
      );
      expect(toDataURL).toHaveBeenCalledExactlyOnceWith("image/png");
      await waitFor(() =>
        expect(mediaSession.metadata?.init).toEqual(expect.objectContaining({
          artwork: [{
            src: "data:image/png;base64,Y29kYS1jb3Zlcg==",
            sizes: "600x600",
            type: "image/png",
          }],
        })),
      );

      unmount();
      unmount = undefined;
      expect(cancelIdleCallback).toHaveBeenCalledWith(17);
      act(() => scheduledArtwork?.());
      expect(getContext).toHaveBeenCalledOnce();
    } finally {
      unmount?.();
      if (requestIdleDescriptor) {
        Object.defineProperty(window, "requestIdleCallback", requestIdleDescriptor);
      } else {
        Reflect.deleteProperty(window, "requestIdleCallback");
      }
      if (cancelIdleDescriptor) {
        Object.defineProperty(window, "cancelIdleCallback", cancelIdleDescriptor);
      } else {
        Reflect.deleteProperty(window, "cancelIdleCallback");
      }
      if (mediaSessionDescriptor) {
        Object.defineProperty(navigator, "mediaSession", mediaSessionDescriptor);
      } else {
        Reflect.deleteProperty(navigator, "mediaSession");
      }
      if (metadataDescriptor) {
        Object.defineProperty(globalThis, "MediaMetadata", metadataDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, "MediaMetadata");
      }
      if (getContextDescriptor) {
        Object.defineProperty(
          HTMLCanvasElement.prototype,
          "getContext",
          getContextDescriptor,
        );
      } else {
        Reflect.deleteProperty(HTMLCanvasElement.prototype, "getContext");
      }
      if (toDataUrlDescriptor) {
        Object.defineProperty(
          HTMLCanvasElement.prototype,
          "toDataURL",
          toDataUrlDescriptor,
        );
      } else {
        Reflect.deleteProperty(HTMLCanvasElement.prototype, "toDataURL");
      }
    }
  });
});
