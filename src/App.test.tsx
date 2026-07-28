import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Album, Track } from "./types";
import { albumQueryKey } from "./libraryQueries";

const mocks = vi.hoisted(() => ({
  beginLastFmAuthorization: vi.fn(),
  checkpointPlayerState: vi.fn(),
  clearPlayerState: vi.fn(),
  completeLastFmAuthorization: vi.fn(),
  connectBandcamp: vi.fn(),
  createSystemArtworkDataUrl: vi.fn(),
  disconnect: vi.fn(),
  disconnectLastFm: vi.fn(),
  fetchAlbum: vi.fn(),
  fetchCoverUrl: vi.fn(),
  fetchLibrary: vi.fn(),
  fetchFavorites: vi.fn(),
  fetchRadioShow: vi.fn(),
  fetchStreamUrl: vi.fn(),
  getLastFmStatus: vi.fn(),
  hasConnection: vi.fn(),
  loadLibraryCache: vi.fn(),
  loadPlayerState: vi.fn(),
  openLastFmAuthorization: vi.fn(),
  openBandcampUrl: vi.fn(),
  readLibraryCache: vi.fn(),
  scrobbleLastFm: vi.fn(),
  savePlayerState: vi.fn(),
  setFavorite: vi.fn(),
  updateLastFmNowPlaying: vi.fn(),
}));

vi.mock("./systemArtwork", () => ({
  createSystemArtworkDataUrl: mocks.createSystemArtworkDataUrl,
}));

vi.mock("./lib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib")>();
  return {
    ...actual,
    beginLastFmAuthorization: mocks.beginLastFmAuthorization,
    checkpointPlayerState: mocks.checkpointPlayerState,
    clearPlayerState: mocks.clearPlayerState,
    completeLastFmAuthorization: mocks.completeLastFmAuthorization,
    connectBandcamp: mocks.connectBandcamp,
    disconnect: mocks.disconnect,
    disconnectLastFm: mocks.disconnectLastFm,
    fetchAlbum: mocks.fetchAlbum,
    fetchCoverUrl: mocks.fetchCoverUrl,
    fetchLibrary: mocks.fetchLibrary,
    fetchFavorites: mocks.fetchFavorites,
    fetchRadioShow: mocks.fetchRadioShow,
    fetchStreamUrl: mocks.fetchStreamUrl,
    getLastFmStatus: mocks.getLastFmStatus,
    hasConnection: mocks.hasConnection,
    isDesktop: () => false,
    loadLibraryCache: mocks.loadLibraryCache,
    openLastFmAuthorization: mocks.openLastFmAuthorization,
    openBandcampUrl: mocks.openBandcampUrl,
    loadPlayerState: mocks.loadPlayerState,
    readLibraryCache: mocks.readLibraryCache,
    scrobbleLastFm: mocks.scrobbleLastFm,
    savePlayerState: mocks.savePlayerState,
    setFavorite: mocks.setFavorite,
    updateLastFmNowPlaying: mocks.updateLastFmNowPlaying,
    writeLibraryCache: vi.fn(),
  };
});

import App from "./App";

function renderApp(strict = false) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const app = (
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  );
  const view = render(
    strict ? <StrictMode>{app}</StrictMode> : app,
  );
  return { ...view, queryClient };
}

const tracks: Track[] = [
  {
    id: "track-1",
    title: "First Light",
    artist: "Night Archive",
    album: "Soft Focus",
    albumId: "album-1",
    duration: 180,
    track: 1,
    streamUrl: "https://example.test/first.mp3",
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
    streamUrl: "https://example.test/after.mp3",
    palette: ["#777", "#222"],
  },
];

const album: Album = {
  id: "album-1",
  title: "Soft Focus",
  artist: "Night Archive",
  songCount: tracks.length,
  duration: tracks.reduce((total, track) => total + track.duration, 0),
  genre: "Ambient",
  tracks,
  palette: ["#777", "#222"],
};

const single: Album = {
  id: "single-1",
  title: "Streetlight",
  artist: "Glass Taxi",
  songCount: 1,
  duration: 164,
  genre: "Electronic",
  tracks: [{
    id: "single-track-1",
    title: "Streetlight",
    artist: "Glass Taxi",
    album: "Streetlight",
    albumId: "single-1",
    duration: 164,
    track: 1,
    streamUrl: "https://example.test/streetlight.mp3",
    palette: ["#968", "#221"],
  }],
  palette: ["#968", "#221"],
};

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

beforeEach(() => {
  window.localStorage.clear();
  mocks.beginLastFmAuthorization.mockReset();
  mocks.checkpointPlayerState.mockReset().mockResolvedValue(true);
  mocks.clearPlayerState.mockReset().mockResolvedValue(undefined);
  mocks.completeLastFmAuthorization.mockReset();
  mocks.connectBandcamp.mockReset();
  mocks.createSystemArtworkDataUrl
    .mockReset()
    .mockReturnValue("data:image/png;base64,Y29kYS1jb3Zlcg==");
  mocks.disconnect.mockReset().mockResolvedValue(undefined);
  mocks.disconnectLastFm.mockReset();
  mocks.fetchAlbum.mockReset().mockResolvedValue(tracks);
  mocks.fetchCoverUrl
    .mockReset()
    .mockResolvedValue("https://t4.bcbits.com/img/restored-cover.jpg");
  mocks.fetchLibrary.mockReset();
  mocks.fetchFavorites.mockReset().mockResolvedValue({
    albumIds: [],
    songIds: [],
    albums: [],
    tracks: [],
  });
  mocks.fetchRadioShow.mockReset().mockResolvedValue({
    id: 979,
    subtitle: "The Coda Broadcast",
    title: "Bandcamp Weekly",
    description: "A broadcast from Bandcamp.",
    publishedAt: "2026-07-20T12:00:00Z",
    duration: 3_600,
    streamUrl: "https://example.test/radio-979-refreshed.mp3",
    artworkUrl: "https://example.test/radio-979.jpg",
    chapters: [
      { title: "Opening signal", artist: "Bandcamp Radio", timecode: 0 },
      {
        title: "Second signal",
        artist: "Night Archive",
        album: "Night Signals",
        timecode: 60,
        artworkUrl: "https://example.test/second-signal.jpg",
        itemUrl: "https://nightarchive.bandcamp.com/track/second-signal",
        artistUrl: "https://nightarchive.bandcamp.com",
        albumUrl: "https://nightarchive.bandcamp.com/album/night-signals",
      },
    ],
  });
  mocks.fetchStreamUrl.mockReset().mockResolvedValue("https://example.test/restored.mp3");
  mocks.getLastFmStatus.mockReset().mockResolvedValue({
    configured: true,
    connected: false,
  });
  mocks.hasConnection.mockReset();
  mocks.loadLibraryCache.mockReset().mockResolvedValue(undefined);
  mocks.loadPlayerState.mockReset().mockResolvedValue(undefined);
  mocks.openLastFmAuthorization.mockReset().mockResolvedValue(undefined);
  mocks.openBandcampUrl.mockReset().mockResolvedValue(undefined);
  mocks.readLibraryCache.mockReset().mockReturnValue([]);
  mocks.scrobbleLastFm.mockReset().mockResolvedValue(undefined);
  mocks.savePlayerState.mockReset().mockResolvedValue(undefined);
  mocks.setFavorite.mockReset().mockResolvedValue(undefined);
  mocks.updateLastFmNowPlaying.mockReset().mockResolvedValue(undefined);
  mocks.hasConnection.mockResolvedValue(false);
});

describe("Coda application flows", { timeout: 10_000 }, () => {
  it("locks the connection form and names the pending Bandcamp request", async () => {
    let resolveConnection!: (albums: Album[]) => void;
    mocks.connectBandcamp.mockReturnValue(new Promise((resolve) => {
      resolveConnection = resolve;
    }));
    renderApp();

    fireEvent.click(await screen.findByRole("button", { name: "Connect Bandcamp" }));
    const dialog = await screen.findByRole("dialog", { name: "Bring in your collection" });
    fireEvent.change(within(dialog).getByLabelText("Subsonic username"), {
      target: { value: "generated-user" },
    });
    fireEvent.change(within(dialog).getByLabelText("Subsonic password"), {
      target: { value: "generated-password" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Connect Bandcamp" }));

    expect(within(dialog).getByRole("button", {
      name: "Connecting securely…",
    })).toBeDisabled();
    expect(within(dialog).getByLabelText("Subsonic username")).toBeDisabled();
    expect(within(dialog).getByLabelText("Subsonic password")).toBeDisabled();

    resolveConnection([album]);
    expect(await screen.findByText("Soft Focus")).toBeInTheDocument();
  });

  it("connects from the valid empty state and renders the returned library", async () => {
    mocks.connectBandcamp.mockResolvedValue([album]);
    renderApp();

    expect(await screen.findByText("Your collection starts here")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Connect Bandcamp" }));

    const dialog = await screen.findByRole("dialog", { name: "Bring in your collection" });
    expect(dialog).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Subsonic username"), {
      target: { value: "generated-user" },
    });
    fireEvent.change(screen.getByLabelText("Subsonic password"), {
      target: { value: "generated-password" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Connect Bandcamp" }));

    await waitFor(() =>
      expect(mocks.connectBandcamp).toHaveBeenCalledWith(
        {
          username: "generated-user",
          password: "generated-password",
        },
        expect.any(Function),
      ),
    );
    expect(await screen.findByText("Soft Focus")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ambient" })).toBeInTheDocument();
  });

  it("uses a fresh native library cache without revalidating", async () => {
    const cachedAt = Date.now();
    mocks.hasConnection.mockResolvedValue(true);
    mocks.loadLibraryCache.mockResolvedValue({
      savedAt: cachedAt,
      lastFullSyncAt: cachedAt,
      albums: [album],
    });
    mocks.fetchLibrary.mockResolvedValue([album]);

    renderApp();

    expect(await screen.findByText("Soft Focus")).toBeInTheDocument();
    expect(mocks.fetchLibrary).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /^sync$/i }));
    await waitFor(() =>
      expect(mocks.fetchLibrary).toHaveBeenCalledWith(expect.any(Function), {
        forceFull: true,
      }),
    );
  });

  it("shows progressive sync pages and restores cached data after a failed refresh", async () => {
    const progressiveAlbum: Album = {
      ...album,
      id: "progressive-album",
      title: "Arriving now",
    };
    let rejectRefresh!: (cause: Error) => void;
    const staleAt = Date.now() - 16 * 60 * 1_000;
    mocks.hasConnection.mockResolvedValue(true);
    mocks.loadLibraryCache.mockResolvedValue({
      savedAt: staleAt,
      lastFullSyncAt: staleAt,
      albums: [album],
    });
    mocks.fetchLibrary.mockImplementation(
      (onPage?: (progress: {
        pageIndex: number;
        loaded: number;
        albums: Album[];
      }) => void) => {
        onPage?.({
          pageIndex: 0,
          loaded: 1,
          albums: [progressiveAlbum],
        });
        return new Promise((_, reject) => {
          rejectRefresh = reject;
        });
      },
    );

    renderApp();

    expect(await screen.findByText("Arriving now")).toBeInTheDocument();
    expect(mocks.fetchLibrary).toHaveBeenCalledWith(expect.any(Function), {
      forceFull: false,
    });
    rejectRefresh(new Error("Refresh unavailable"));
    expect(await screen.findByText("Refresh unavailable")).toBeInTheDocument();
    expect(screen.getByText("Soft Focus")).toBeInTheDocument();
    expect(screen.queryByText("Arriving now")).not.toBeInTheDocument();
  });

  it("ignores a native cache read that resolves after disconnect", async () => {
    let resolveCache!: (snapshot: {
      savedAt: number;
      lastFullSyncAt: number;
      albums: Album[];
    }) => void;
    mocks.hasConnection.mockResolvedValue(true);
    mocks.loadLibraryCache.mockReturnValue(new Promise((resolve) => {
      resolveCache = resolve;
    }));
    mocks.fetchLibrary.mockResolvedValue([album]);

    renderApp();

    await screen.findByText("Bandcamp synced");
    fireEvent.click(screen.getByRole("button", { name: "Connection settings" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Bandcamp is connected",
    });
    const disconnectButton = within(dialog).getByRole("button", {
      name: "Disconnect and remove Bandcamp credentials",
    });
    expect(disconnectButton).toHaveClass("connection-dialog__disconnect");
    expect(disconnectButton).not.toHaveClass("danger-button");
    fireEvent.click(disconnectButton);
    expect(await screen.findByText("Your collection starts here")).toBeInTheDocument();

    const cachedAt = Date.now();
    resolveCache({
      savedAt: cachedAt,
      lastFullSyncAt: cachedAt,
      albums: [album],
    });
    await waitFor(() => expect(mocks.fetchLibrary).not.toHaveBeenCalled());
    expect(screen.queryByText("Soft Focus")).not.toBeInTheDocument();
  });

  it("clears authenticated album queries after a successful disconnect", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    const { queryClient } = renderApp();

    await screen.findByText("Soft Focus");
    queryClient.setQueryData(["bandcamp", "album", album.id], tracks);
    queryClient.setQueryData(["bandcamp-radio-show", 979], { id: 979 });
    fireEvent.click(screen.getByRole("button", { name: "Connection settings" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Bandcamp is connected",
    });
    fireEvent.click(within(dialog).getByRole("button", {
      name: "Disconnect and remove Bandcamp credentials",
    }));

    expect(await screen.findByText("Your collection starts here")).toBeInTheDocument();
    expect(queryClient.getQueryData(["bandcamp", "album", album.id]))
      .toBeUndefined();
    expect(queryClient.getQueryData(["bandcamp-radio-show", 979])).toEqual({
      id: 979,
    });
  });

  it("does not let a bulk artist load restore playback after disconnect", async () => {
    const firstAlbum: Album = {
      ...album,
      tracks: undefined,
    };
    const secondTrack: Track = {
      ...tracks[1],
      id: "track-3",
      album: "Night Signals",
      albumId: "album-2",
      track: 1,
    };
    const secondAlbum: Album = {
      ...album,
      id: "album-2",
      title: "Night Signals",
      tracks: undefined,
    };
    let resolveFirstAlbum!: (value: Track[]) => void;
    let resolveSecondAlbum!: (value: Track[]) => void;
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([firstAlbum, secondAlbum]);
    mocks.fetchAlbum
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveFirstAlbum = resolve;
      }))
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveSecondAlbum = resolve;
      }));
    const { queryClient } = renderApp();

    await screen.findByText("Soft Focus");
    fireEvent.click(screen.getAllByTitle("Browse Night Archive")[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Play all" }));
    await waitFor(() => expect(mocks.fetchAlbum).toHaveBeenCalledTimes(2));
    const firstRequestedAlbum = mocks.fetchAlbum.mock.calls[0][0] as Album;

    await act(async () => {
      resolveFirstAlbum([tracks[0]]);
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(queryClient.getQueryData(["bandcamp", "album", firstRequestedAlbum.id]))
        .toEqual([tracks[0]]),
    );

    fireEvent.click(screen.getByRole("button", { name: "Connection settings" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Bandcamp is connected",
    });
    fireEvent.click(within(dialog).getByRole("button", {
      name: "Disconnect and remove Bandcamp credentials",
    }));
    expect(await screen.findByText("Your collection starts here")).toBeInTheDocument();

    await act(async () => {
      resolveSecondAlbum([secondTrack]);
      await Promise.resolve();
    });

    expect(screen.getByText("Your collection starts here")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Now Playing" }))
      .not.toBeInTheDocument();
    expect(screen.queryByText("Playing Night Archive")).not.toBeInTheDocument();
    expect(queryClient.getQueryCache().findAll({
      queryKey: ["bandcamp", "album"],
    })).toHaveLength(0);
  });

  it("force-refreshes missing artwork through the album query", async () => {
    const missingArtworkAlbum: Album = {
      ...album,
      tracks: undefined,
      coverArt: undefined,
    };
    const recoveredTracks = tracks.map((track) => ({
      ...track,
      coverArt: "recovered-cover",
    }));
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([missingArtworkAlbum]);
    mocks.fetchAlbum.mockResolvedValue(recoveredTracks);
    renderApp();

    await screen.findByText("Soft Focus");
    fireEvent.click(screen.getByRole("button", { name: "Artwork" }));

    await waitFor(() =>
      expect(mocks.fetchAlbum).toHaveBeenCalledWith(
        expect.objectContaining({ id: album.id }),
        { forceRefresh: true },
      ),
    );
    expect(await screen.findByText("1 missing cover recovered")).toBeInTheDocument();
  });

  it("keeps an active sync valid when native disconnect fails", async () => {
    let resolveRefresh!: (albums: Album[]) => void;
    const staleAt = Date.now() - 16 * 60 * 1_000;
    mocks.hasConnection.mockResolvedValue(true);
    mocks.loadLibraryCache.mockResolvedValue({
      savedAt: staleAt,
      lastFullSyncAt: staleAt,
      albums: [album],
    });
    mocks.fetchLibrary.mockReturnValue(new Promise((resolve) => {
      resolveRefresh = resolve;
    }));
    mocks.disconnect.mockRejectedValue(new Error("Vault unavailable"));

    renderApp();

    await screen.findByText("Soft Focus");
    fireEvent.click(screen.getByRole("button", { name: "Connection settings" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Bandcamp is connected",
    });
    fireEvent.click(within(dialog).getByRole("button", {
      name: "Disconnect and remove Bandcamp credentials",
    }));
    expect(await within(dialog).findByText("Vault unavailable")).toBeInTheDocument();

    resolveRefresh([{ ...album, title: "Sync still active" }]);
    expect(await screen.findByText("Sync still active")).toBeInTheDocument();
  });

  it("plays an album, exposes native AirPlay, and preserves now playing when clearing", async () => {
    const airPlayPicker = vi.fn();
    Object.defineProperty(HTMLMediaElement.prototype, "webkitShowPlaybackTargetPicker", {
      configurable: true,
      value: airPlayPicker,
    });
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    const { container } = renderApp(true);

    await screen.findByText("Soft Focus");
    fireEvent.click(screen.getByRole("button", { name: "Play Soft Focus" }));

    expect(await screen.findByRole("button", { name: "Open Now Playing" }))
      .toBeInTheDocument();
    expect(screen.getAllByText("First Light").length).toBeGreaterThan(0);
    const player = container.querySelector<HTMLElement>(".player");
    const favorite = screen.getByRole("button", {
      name: "Add First Light to favorites",
    });
    expect(favorite.closest(".player__track-title-row")).not.toBeNull();
    expect(player?.querySelector(".player__track")?.contains(favorite))
      .toBe(true);
    expect(player?.querySelector(".player__volume")?.contains(favorite))
      .toBe(false);
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

    const audio = container.querySelector("audio")!;
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

  it("restarts with Previous near the track body and disables unavailable transport", async () => {
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

    await screen.findByRole("button", { name: "Open Now Playing" });

    const player = container.querySelector<HTMLElement>(".player");
    expect(player).not.toBeNull();
    const previous = within(player!).getByRole("button", { name: "Previous" });
    const next = within(player!).getByRole("button", { name: "Next" });
    const audio = container.querySelector("audio")!;

    expect(previous).toBeDisabled();
    await waitFor(() => expect(next).toBeEnabled());

    audio.currentTime = 6;
    fireEvent.timeUpdate(audio);
    expect(previous).toBeEnabled();
    fireEvent.click(previous);

    expect(audio.currentTime).toBe(0);
    expect(within(player!).getByText("First Light")).toBeInTheDocument();
    expect(previous).toBeDisabled();

    fireEvent.click(next);
    await waitFor(() =>
      expect(within(player!).getByText("Afterimage")).toBeInTheDocument(),
    );
    expect(next).toBeDisabled();
    expect(previous).toBeEnabled();

    fireEvent.click(within(player!).getByRole("button", { name: "Repeat off" }));
    expect(next).toBeEnabled();
    fireEvent.click(next);
    expect(within(player!).getByText("First Light")).toBeInTheDocument();
  });

  it("publishes rich WebKit media state and routes next-track controls", async () => {
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
    const mediaSession = {
      metadata: null as MediaMetadata | null,
      playbackState: "none" as MediaSessionPlaybackState,
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
    class MockMediaMetadata {
      constructor(readonly init: MediaMetadataInit) {}
    }
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
      queue: tracks.map(({ streamUrl: _streamUrl, ...track }, index) => ({
        ...track,
        ...(index === 0 ? { coverArt: "ca:496796527" } : {}),
      })),
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
      await screen.findByRole("button", { name: "Open Now Playing" });

      expect(handlers.get("seekforward")).toBeNull();
      expect(
        setActionHandler.mock.calls.filter(
          ([action, handler]) =>
            action === "nexttrack" && typeof handler === "function",
        ),
      ).toHaveLength(1);
      const skipTrack = handlers.get("nexttrack");
      expect(skipTrack).toBeTypeOf("function");
      await waitFor(() =>
        expect(
          (mediaSession.metadata as unknown as MockMediaMetadata | null)?.init,
        ).toEqual({
          title: "First Light",
          artist: "Night Archive",
          album: "Soft Focus",
          artwork: [{
            src: "https://t4.bcbits.com/img/restored-cover.jpg",
          }],
        }),
      );
      expect(mocks.fetchCoverUrl).toHaveBeenCalledExactlyOnceWith(
        "ca:496796527",
      );
      expect(setPositionState).toHaveBeenCalledWith({
        duration: 180,
        playbackRate: 1,
        position: 0,
      });
      act(() => skipTrack?.({ action: "nexttrack" }));

      const player = view.container.querySelector<HTMLElement>(".player");
      await waitFor(() =>
        expect(within(player!).getByText("Afterimage")).toBeInTheDocument(),
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
        delete (globalThis as { MediaMetadata?: typeof MediaMetadata })
          .MediaMetadata;
      }
    }
  });

  it("durably saves a changed queue after the structural debounce", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    renderApp();

    await screen.findByText("Soft Focus");
    fireEvent.click(screen.getByRole("button", { name: "Play Soft Focus" }));

    await waitFor(
      () =>
        expect(mocks.savePlayerState).toHaveBeenCalledWith(
          expect.objectContaining({
            queue: tracks,
            currentIndex: 0,
          }),
        ),
      { timeout: 1_500 },
    );
  });

  it("toggles the queue pane from the dedicated player control", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    renderApp();

    await screen.findByText("Soft Focus");
    const appBody = document.querySelector(".app-body");
    expect(appBody).not.toBeNull();
    const libraryPane = screen.getByRole("main");
    expect(screen.queryByRole("complementary", { name: "Playback queue" }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show queue" }))
      .toHaveAttribute("aria-pressed", "false");
    expect(appBody).toHaveClass("app-body--queue-closed");

    fireEvent.click(screen.getByRole("button", { name: "Show queue" }));
    await waitFor(() =>
      expect(screen.getByRole("complementary", { name: "Playback queue" })).toHaveFocus(),
    );
    expect(screen.getByRole("region", { name: "Upcoming tracks" })).toHaveAttribute(
      "tabindex",
      "0",
    );
    expect(screen.getByRole("button", { name: "Hide queue" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(appBody).not.toHaveClass("app-body--queue-closed");
    expect(screen.getByRole("main")).toBe(libraryPane);

    fireEvent.click(screen.getByRole("button", { name: "Hide queue" }));
    expect(screen.queryByRole("complementary", { name: "Playback queue" }))
      .not.toBeInTheDocument();
    expect(document.querySelector(".queue-panel--closing"))
      .toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("button", { name: "Show queue" }))
      .toHaveAttribute("aria-pressed", "false");
    expect(appBody).toHaveClass("app-body--queue-closed");
    expect(screen.getByRole("main")).toBe(libraryPane);
  });

  it("does not reopen a saved queue drawer without a restorable current track", async () => {
    mocks.loadPlayerState.mockResolvedValue({
      version: 1,
      savedAt: Date.now(),
      queue: [],
      currentIndex: 0,
      positionSeconds: 0,
      volume: 0.72,
      repeatMode: "off",
      queueOpen: true,
    });
    renderApp();

    await waitFor(() => expect(mocks.loadPlayerState).toHaveBeenCalledOnce());
    expect(screen.queryByRole("complementary", { name: "Playback queue" }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show queue" }))
      .toHaveAttribute("aria-pressed", "false");
  });

  it("reports the actual native restore failure instead of blaming a pause", async () => {
    mocks.loadPlayerState.mockRejectedValue(
      new Error("The native player-state contract is temporarily unavailable."),
    );
    renderApp();

    expect(await screen.findByText(
      "Coda could not restore the previous listening session: " +
      "The native player-state contract is temporarily unavailable.",
    )).toBeInTheDocument();
  });

  it("connects Last.fm without asking Coda for a Last.fm password", async () => {
    mocks.beginLastFmAuthorization.mockResolvedValue({
      authorizationUrl: "https://www.last.fm/api/auth/?api_key=key&token=token",
      token: "token",
    });
    mocks.completeLastFmAuthorization.mockResolvedValue({
      configured: true,
      connected: true,
      username: "nightlistener",
    });
    renderApp();

    fireEvent.click(screen.getByRole("button", { name: "Connection settings" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByLabelText(/Last\.fm password/i)).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Connect Last.fm" }));
    await waitFor(() => expect(mocks.openLastFmAuthorization).toHaveBeenCalledOnce());
    fireEvent.click(within(dialog).getByRole("button", { name: "Finish connection" }));

    expect(await within(dialog).findByText("nightlistener")).toBeInTheDocument();
    expect(mocks.completeLastFmAuthorization).toHaveBeenCalledWith("token");
  });

  it("updates Now Playing and scrobbles after actual listened time", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    const enrichedTrack = {
      ...tracks[0],
      albumArtist: "Night Archive & Guests",
      musicBrainzId: "189002e7-3285-4e2e-92a3-7f6c30d407a2",
    };
    mocks.fetchLibrary.mockResolvedValue([{
      ...album,
      tracks: [enrichedTrack, tracks[1]],
    }]);
    mocks.fetchAlbum.mockResolvedValue([enrichedTrack, tracks[1]]);
    mocks.getLastFmStatus.mockResolvedValue({
      configured: true,
      connected: true,
      username: "nightlistener",
    });
    const { container, queryClient } = renderApp();

    await screen.findByText("Soft Focus");
    expect(
      queryClient.getQueryData<Album[]>(["bandcamp", "library"])?.[0].tracks,
    ).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Connection settings" }));
    const settings = await screen.findByRole("dialog");
    expect(await within(settings).findByText("nightlistener")).toBeInTheDocument();
    fireEvent.click(within(settings).getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Play Soft Focus" }));
    await screen.findByRole("button", { name: "Open Now Playing" });
    const audio = container.querySelector("audio");
    expect(audio).not.toBeNull();
    await waitFor(() => {
      expect(audio).toHaveAttribute("src", enrichedTrack.streamUrl);
    });
    fireEvent.playing(audio!);
    await waitFor(() => expect(mocks.updateLastFmNowPlaying).toHaveBeenCalledOnce());

    for (let position = 10; position <= 90; position += 10) {
      audio!.currentTime = position;
      fireEvent.timeUpdate(audio!);
    }
    await waitFor(() => expect(mocks.scrobbleLastFm).toHaveBeenCalledOnce());
    expect(mocks.scrobbleLastFm.mock.calls[0][0]).toMatchObject({
      artist: "Night Archive",
      title: "First Light",
      album: "Soft Focus",
      albumArtist: "Night Archive & Guests",
      musicBrainzId: "189002e7-3285-4e2e-92a3-7f6c30d407a2",
      chosenByUser: true,
    });
  });

  it("plays one random track from the current browsing context", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album, single]);
    renderApp();

    await screen.findByText("Soft Focus");
    fireEvent.click(screen.getByRole("button", { name: /Singles\s*1/ }));
    fireEvent.click(screen.getByRole("button", {
      name: "Play a random track from the singles view",
    }));

    expect(await screen.findByRole("button", { name: "Open Now Playing" }))
      .toBeInTheDocument();
    expect(screen.getAllByText("Streetlight").length).toBeGreaterThan(0);
  });

  it("restores the saved queue paused and applies its position after media metadata loads", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    mocks.loadPlayerState.mockResolvedValue({
      version: 1,
      savedAt: Date.now(),
      queue: tracks.map(({ streamUrl: _streamUrl, artworkUrl: _artworkUrl, ...track }) => track),
      currentIndex: 1,
      positionSeconds: 42,
      volume: 0.44,
      repeatMode: "one",
      queueOpen: false,
      lastFmProgress: {
        trackId: "track-2",
        startedAt: 0,
        listenedSeconds: 80,
        lastPosition: 42,
        nowPlayingSent: false,
        scrobbleState: "sent",
      },
    });
    const { container } = renderApp();

    expect(await screen.findByRole("button", { name: "Open Now Playing" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show queue" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getAllByText("Afterimage").length).toBeGreaterThan(0);
    await waitFor(() => expect(mocks.fetchStreamUrl).toHaveBeenCalledWith("track-2"));

    const audio = container.querySelector("audio");
    expect(audio).not.toBeNull();
    Object.defineProperty(audio!, "duration", {
      configurable: true,
      value: 210,
    });
    fireEvent.loadedMetadata(audio!);
    expect(audio!.currentTime).toBe(42);
    expect(screen.getByLabelText("Track position")).toHaveValue("42");
  });

  it("refreshes a restored Radio show and resumes its saved playhead without a connection", async () => {
    mocks.hasConnection.mockResolvedValue(false);
    mocks.loadPlayerState.mockResolvedValue({
      version: 1,
      savedAt: Date.now(),
      queue: [{
        id: "radio:979",
        title: "The Coda Broadcast",
        artist: "Bandcamp Radio",
        album: "Bandcamp Weekly",
        albumId: "radio:979",
        duration: 3_600,
        track: 1,
        palette: ["#ca6954", "#241b1a"],
      }],
      currentIndex: 0,
      positionSeconds: 65,
      volume: 0.7,
      repeatMode: "off",
      queueOpen: false,
      radioScrobbleProgress: {
        showTrackId: "radio:979",
        activeChapterKey: "60:chapter",
        chapterStartedAt: 0,
        chapterListenedSeconds: 5,
        lastPosition: 65,
        chapterNowPlayingSent: false,
        chapterScrobbleState: "idle",
        showStartedAt: 0,
        showListenedSeconds: 65,
        showScrobbleState: "idle",
        scrobbledChapterKeys: [],
      },
    });
    const { container } = renderApp();

    await waitFor(() => expect(mocks.fetchRadioShow).toHaveBeenCalledWith(979));
    await waitFor(() =>
      expect(container.querySelector("audio")).toHaveAttribute(
        "src",
        "https://example.test/radio-979-refreshed.mp3",
      ),
    );
    expect(screen.getAllByText("Second signal").length).toBeGreaterThan(0);
    expect(mocks.fetchStreamUrl).not.toHaveBeenCalledWith("radio:979");
    const miniArtwork = screen.getByRole("button", { name: "Open Now Playing" });
    await waitFor(() =>
      expect(within(miniArtwork).getByRole("img")).toHaveAttribute(
        "src",
        "https://example.test/second-signal.jpg",
      ),
    );

    fireEvent.click(miniArtwork);
    const nowPlaying = screen.getByRole("article", { name: "The Coda Broadcast" });
    await waitFor(() =>
      expect(within(nowPlaying).getByRole("img")).toHaveAttribute(
        "src",
        "https://example.test/second-signal.jpg",
      ),
    );
    fireEvent.click(within(nowPlaying).getByRole("button", { name: "Back" }));
    const restoredMiniArtwork = screen.getByRole("button", {
      name: "Open Now Playing",
    });
    fireEvent.error(within(restoredMiniArtwork).getByRole("img"));
    expect(within(restoredMiniArtwork).getByRole("img")).toHaveAttribute(
      "src",
      "https://example.test/radio-979.jpg",
    );

    const audio = container.querySelector("audio")!;
    Object.defineProperty(audio, "duration", {
      configurable: true,
      value: 3_600,
    });
    fireEvent.loadedMetadata(audio);
    expect(audio.currentTime).toBe(65);
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {
      name: "Open Second signal by Night Archive on Bandcamp",
    }));
    expect(mocks.openBandcampUrl).toHaveBeenCalledWith(
      "https://nightarchive.bandcamp.com/track/second-signal",
    );
    await waitFor(() =>
      expect(mocks.checkpointPlayerState).toHaveBeenCalledWith(
        expect.objectContaining({
          currentTrackId: "radio:979",
          positionSeconds: 65,
          radioScrobbleProgress: expect.objectContaining({
            showTrackId: "radio:979",
            showListenedSeconds: 65,
          }),
        }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Show queue" }));
    const queuePanel = screen.getByRole("complementary", { name: "Playback queue" });
    fireEvent.click(within(queuePanel).getByRole("button", {
      name: "Open artist Night Archive on Bandcamp",
    }));
    expect(mocks.openBandcampUrl).toHaveBeenCalledWith(
      "https://nightarchive.bandcamp.com",
    );
    const chapters = await screen.findByRole("region", { name: "Show chapters" });
    expect(within(chapters).getByRole("button", {
      name: "Seek to Second signal at 1:00",
    })).toHaveAttribute("aria-current", "true");
    fireEvent.click(within(chapters).getByRole("button", {
      name: "Seek to Opening signal at 0:00",
    }));
    expect(audio.currentTime).toBe(0);
    expect(within(
      screen.getByRole("button", { name: "Open Now Playing" }),
    ).getByRole("img")).toHaveAttribute(
      "src",
      "https://example.test/radio-979.jpg",
    );
    expect(within(chapters).getByRole("button", {
      name: "Seek to Opening signal at 0:00",
    })).toHaveAttribute("aria-current", "true");
  });

  it("uses player Previous and Next as Radio chapter transport before changing queue items", async () => {
    mocks.fetchRadioShow.mockResolvedValue({
      id: 979,
      subtitle: "The Coda Broadcast",
      title: "Bandcamp Weekly",
      description: "A broadcast from Bandcamp.",
      publishedAt: "2026-07-20T12:00:00Z",
      duration: 3_600,
      streamUrl: "https://example.test/radio-979-refreshed.mp3",
      chapters: [
        { title: "Opening signal", artist: "Bandcamp Radio", timecode: 0 },
        { title: "Second signal", artist: "Night Archive", timecode: 60 },
        { title: "Final signal", artist: "Signal Path", timecode: 120 },
      ],
    });
    mocks.loadPlayerState.mockResolvedValue({
      version: 1,
      savedAt: Date.now(),
      queue: [
        {
          id: "radio:979",
          title: "The Coda Broadcast",
          artist: "Bandcamp Radio",
          album: "Bandcamp Weekly",
          albumId: "radio:979",
          duration: 3_600,
          track: 1,
          palette: ["#ca6954", "#241b1a"],
        },
        tracks[0],
      ],
      currentIndex: 0,
      positionSeconds: 65,
      volume: 0.7,
      repeatMode: "off",
      queueOpen: false,
    });
    const { container } = renderApp();

    await waitFor(() => expect(mocks.fetchRadioShow).toHaveBeenCalledWith(979));
    const audio = container.querySelector("audio")!;
    Object.defineProperty(audio, "duration", {
      configurable: true,
      value: 3_600,
    });
    fireEvent.loadedMetadata(audio);
    expect(audio.currentTime).toBe(65);
    expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(audio.currentTime).toBe(120);

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(audio.currentTime).toBe(60);

    audio.currentTime = 120;
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findAllByText("First Light")).not.toHaveLength(0);
    expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("scrobbles Radio chapters and the completed show as separate radio selections", async () => {
    mocks.getLastFmStatus.mockResolvedValue({
      configured: true,
      connected: true,
      username: "nightlistener",
    });
    mocks.loadPlayerState.mockResolvedValue({
      version: 1,
      savedAt: Date.now(),
      queue: [{
        id: "radio:979",
        title: "The Coda Broadcast",
        artist: "Bandcamp Radio",
        album: "Bandcamp Weekly",
        albumId: "radio:979",
        duration: 3_600,
        track: 1,
        palette: ["#ca6954", "#241b1a"],
      }],
      currentIndex: 0,
      positionSeconds: 60,
      volume: 0.7,
      repeatMode: "off",
      queueOpen: false,
    });
    const { container } = renderApp();

    await waitFor(() => expect(mocks.fetchRadioShow).toHaveBeenCalledWith(979));
    const audio = container.querySelector("audio")!;
    Object.defineProperty(audio, "duration", {
      configurable: true,
      value: 3_600,
    });
    fireEvent.loadedMetadata(audio);
    fireEvent.click(await screen.findByRole("button", { name: "Play" }));
    fireEvent.playing(audio);
    await waitFor(() => expect(mocks.updateLastFmNowPlaying).toHaveBeenCalledWith(
      expect.objectContaining({
        artist: "Night Archive",
        title: "Second signal",
        chosenByUser: false,
      }),
    ));

    for (let position = 70; position <= 300; position += 10) {
      audio.currentTime = position;
      fireEvent.timeUpdate(audio);
    }
    await waitFor(() => expect(mocks.scrobbleLastFm).toHaveBeenCalledTimes(1));
    expect(mocks.scrobbleLastFm.mock.calls[0][0]).toMatchObject({
      artist: "Night Archive",
      title: "Second signal",
      chosenByUser: false,
    });

    audio.currentTime = 3_600;
    fireEvent.ended(audio);
    await waitFor(() => expect(mocks.scrobbleLastFm).toHaveBeenCalledTimes(2));
    expect(mocks.scrobbleLastFm.mock.calls[1][0]).toMatchObject({
      artist: "Bandcamp Radio",
      title: "The Coda Broadcast",
      chosenByUser: false,
    });
  });

  it("retains a large restored queue while bounding upcoming track rendering", async () => {
    const largeQueue = Array.from({ length: 300 }, (_, index): Track => ({
      ...tracks[0],
      id: `large-track-${index}`,
      title: `Large queue track ${index}`,
      track: index + 1,
      streamUrl: undefined,
    }));
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    mocks.loadPlayerState.mockResolvedValue({
      version: 1,
      savedAt: Date.now(),
      queue: largeQueue,
      currentIndex: 0,
      positionSeconds: 0,
      volume: 0.72,
      repeatMode: "off",
      queueOpen: true,
    });
    renderApp();

    const queueRegion = await screen.findByRole("region", {
      name: "Upcoming tracks",
    });
    await waitFor(() =>
      expect(queueRegion).toHaveAttribute("data-virtualized", "true"),
    );
    expect(within(queueRegion).queryAllByRole("listitem").length).toBeLessThan(40);
    expect(screen.queryByText("Large queue track 299")).not.toBeInTheDocument();
    expect(screen.getByText("299 tracks next")).toBeInTheDocument();
  });

  it("separates release types and navigates through artist and album views", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album, single]);
    mocks.fetchAlbum.mockImplementation((requestedAlbum: Album) =>
      Promise.resolve(
        requestedAlbum.id === single.id ? single.tracks : album.tracks,
      ),
    );
    renderApp();

    await screen.findByText("Soft Focus");
    fireEvent.click(screen.getByRole("button", { name: /Singles\s*1/ }));
    expect(await screen.findByText("Streetlight")).toBeInTheDocument();
    expect(screen.queryByText("Soft Focus")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Shuffle singles" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open Streetlight" }));
    const singlePage = await screen.findByRole("article", {
      name: "Streetlight release details",
    });
    expect(singlePage).toBeInTheDocument();
    expect(within(singlePage).getByText("#")).toHaveClass("tracklist__number-heading");
    expect(within(singlePage).getByTitle("Duration")).toHaveClass(
      "tracklist__duration-heading",
    );
    expect(singlePage.querySelector(".track-row__duration")).toHaveTextContent("2:44");
    expect(screen.getByRole("heading", { name: "1 song" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Shuffle album" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to releases" }));

    fireEvent.click(screen.getByTitle("Browse Glass Taxi"));
    expect(await screen.findByRole("heading", { name: "Glass Taxi" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All artists" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play all" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Shuffle artist" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Shuffle" }));
    expect(await screen.findByRole("button", { name: "Open Now Playing" }))
      .toBeInTheDocument();
    expect(screen.getAllByText("Streetlight").length).toBeGreaterThan(0);
  });

  it("prefetches a deliberate album hover and opens cached tracks immediately", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    const { queryClient } = renderApp();

    await screen.findByText("Soft Focus");
    const openButton = screen.getByRole("button", { name: "Open Soft Focus" });
    const albumCard = openButton.closest(".album-card")!;
    mocks.fetchAlbum.mockClear();
    vi.useFakeTimers();
    try {
      fireEvent.pointerEnter(albumCard);
      fireEvent.pointerLeave(albumCard);
      await act(async () => vi.runAllTimers());
      expect(mocks.fetchAlbum).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }

    fireEvent.pointerEnter(albumCard);
    await waitFor(() =>
      expect(queryClient.getQueryData(albumQueryKey(album.id))).toEqual(tracks),
    );

    mocks.fetchAlbum.mockClear();
    fireEvent.click(openButton);

    const albumPage = screen.getByRole("article", {
      name: "Soft Focus release details",
    });
    expect(within(albumPage).getByText("First Light")).toBeInTheDocument();
    expect(within(albumPage).getByText("Afterimage")).toBeInTheDocument();
    expect(within(albumPage).queryByText("Loading tracks…")).not.toBeInTheDocument();
    expect(mocks.fetchAlbum).not.toHaveBeenCalled();
  });

  it("keeps a cold album busy when an older album request settles", async () => {
    const secondTracks: Track[] = [{
      ...tracks[0],
      id: "track-second",
      title: "Other Light",
      album: "Other Focus",
      albumId: "album-2",
    }];
    const secondAlbum: Album = {
      ...album,
      id: "album-2",
      title: "Other Focus",
      songCount: secondTracks.length,
      duration: secondTracks[0].duration,
      tracks: secondTracks,
    };
    const firstRequest = deferred<Track[]>();
    const secondRequest = deferred<Track[]>();
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album, secondAlbum]);
    mocks.fetchAlbum.mockImplementation((requestedAlbum: Album) =>
      requestedAlbum.id === album.id
        ? firstRequest.promise
        : secondRequest.promise,
    );
    renderApp();

    await screen.findByText("Soft Focus");
    fireEvent.click(screen.getByRole("button", { name: "Play Soft Focus" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Other Focus" }));
    const albumPage = await screen.findByRole("article", {
      name: "Other Focus release details",
    });
    expect(within(albumPage).getByText("Loading tracks…")).toBeInTheDocument();

    await act(async () => firstRequest.resolve(tracks));

    expect(within(albumPage).getByText("Loading tracks…")).toBeInTheDocument();
    await act(async () => secondRequest.resolve(secondTracks));
    expect(within(albumPage).getByText("Other Light")).toBeInTheDocument();
  });

  it("shows a bounded accessible skeleton while a cold album loads", async () => {
    const request = deferred<Track[]>();
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    mocks.fetchAlbum.mockReturnValueOnce(request.promise);
    renderApp();

    await screen.findByText("Soft Focus");
    fireEvent.click(screen.getByRole("button", { name: "Open Soft Focus" }));
    const albumPage = await screen.findByRole("article", {
      name: "Soft Focus release details",
    });
    const trackList = within(albumPage).getByRole("region", {
      name: "Track list",
    });

    expect(trackList).toHaveAttribute("aria-busy", "true");
    expect(within(trackList).getByRole("status", {
      name: "Loading tracks for Soft Focus",
    })).toBeInTheDocument();
    expect(trackList.querySelectorAll(".track-row--skeleton")).toHaveLength(3);

    await act(async () => request.resolve(tracks));
  });

  it("opens Now Playing from the player artwork and returns to the exact prior view", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    renderApp();

    await screen.findByText("Soft Focus");
    fireEvent.click(screen.getByRole("button", { name: "Open Soft Focus" }));
    const albumPage = await screen.findByRole("article", { name: "Soft Focus release details" });
    fireEvent.click(within(albumPage).getByRole("button", { name: "Play album" }));

    fireEvent.click(await screen.findByRole("button", { name: "Open Now Playing" }));
    const nowPlaying = screen.getByRole("article", { name: "First Light" });
    expect(within(nowPlaying).getByText("Playing now")).toBeInTheDocument();
    expect(within(nowPlaying).queryByText("Now playing")).not.toBeInTheDocument();
    expect(within(nowPlaying).getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();
    expect(within(nowPlaying).getByRole("heading", { name: "First Light" })).toHaveFocus();
    expect(document.title).toBe("First Light — Coda");

    fireEvent.click(within(nowPlaying).getByRole("button", {
      name: "Back",
    }));
    expect(screen.getByRole("article", { name: "Soft Focus release details" })).toBeInTheDocument();
    const miniArtwork = screen.getByRole("button", { name: "Open Now Playing" });
    expect(miniArtwork).toBeInTheDocument();
    await waitFor(() => expect(miniArtwork).toHaveFocus());
  });

  it("matches album and track controls to the current playing and paused state", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    renderApp();

    await screen.findByText("Soft Focus");
    fireEvent.click(screen.getByRole("button", { name: "Open Soft Focus" }));
    const albumPage = await screen.findByRole("article", {
      name: "Soft Focus release details",
    });
    fireEvent.click(within(albumPage).getByRole("button", { name: "Play album" }));

    expect(await within(albumPage).findByRole("button", {
      name: "Pause Soft Focus",
    })).toHaveAttribute("aria-pressed", "true");
    const pauseTrack = within(albumPage).getByRole("button", {
      name: "Pause First Light",
    });
    expect(pauseTrack).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(pauseTrack);
    expect(within(albumPage).getByRole("button", { name: "Resume Soft Focus" }))
      .toHaveAttribute("aria-pressed", "false");
    expect(within(albumPage).getByRole("button", { name: "Resume First Light" }))
      .toHaveAttribute("aria-pressed", "false");
  });

  it("uses a shared-element view transition when the WebView supports it", async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "startViewTransition",
    );
    const startViewTransition = vi.fn((update: () => void) => {
      update();
      return { finished: Promise.resolve() };
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    try {
      mocks.hasConnection.mockResolvedValue(true);
      mocks.fetchLibrary.mockResolvedValue([album]);
      renderApp();

      await screen.findByText("Soft Focus");
      fireEvent.click(screen.getByRole("button", { name: "Play Soft Focus" }));
      fireEvent.click(await screen.findByRole("button", { name: "Open Now Playing" }));

      const nowPlaying = screen.getByRole("article", { name: "First Light" });
      expect(startViewTransition).toHaveBeenCalledOnce();
      expect(document.documentElement).toHaveClass("coda-view-transitions-supported");

      fireEvent.click(within(nowPlaying).getByRole("button", {
        name: "Back",
      }));
      expect(startViewTransition).toHaveBeenCalledTimes(2);
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Open Now Playing" })).toHaveFocus(),
      );
    } finally {
      document.documentElement.classList.remove(
        "coda-view-transitioning",
        "coda-view-transitions-supported",
      );
      if (originalDescriptor) {
        Object.defineProperty(document, "startViewTransition", originalDescriptor);
      } else {
        Reflect.deleteProperty(document, "startViewTransition");
      }
    }
  });

  it("switches primary destinations without waiting for a WebView snapshot", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    renderApp();

    await screen.findByText("Soft Focus");
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "startViewTransition",
    );
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: vi.fn(() => ({ finished: Promise.resolve() })),
    });

    try {
      fireEvent.click(screen.getByRole("button", { name: "Recently added" }));

      expect(screen.getByRole("heading", { name: "Recently added" }))
        .toBeInTheDocument();
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(document, "startViewTransition", originalDescriptor);
      } else {
        Reflect.deleteProperty(document, "startViewTransition");
      }
    }
  });

  it("links Now Playing metadata to artist and album pages", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    const { unmount } = renderApp();

    await screen.findByText("Soft Focus");
    fireEvent.click(screen.getByRole("button", { name: "Play Soft Focus" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open Now Playing" }));
    let nowPlaying = screen.getByRole("article", { name: "First Light" });
    fireEvent.click(within(nowPlaying).getByRole("button", { name: "Night Archive" }));
    expect(await screen.findByRole("heading", { name: "Night Archive" })).toBeInTheDocument();

    unmount();
    renderApp();
    await screen.findByText("Soft Focus");
    fireEvent.click(screen.getByRole("button", { name: "Play Soft Focus" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open Now Playing" }));
    nowPlaying = screen.getByRole("article", { name: "First Light" });
    fireEvent.click(within(nowPlaying).getByRole("button", { name: "Soft Focus" }));
    expect(await screen.findByRole("article", {
      name: "Soft Focus release details",
    })).toBeInTheDocument();
  });

  it("drives the shared player state from the Now Playing controls", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    const { container } = renderApp();

    await screen.findByText("Soft Focus");
    fireEvent.click(screen.getByRole("button", { name: "Play Soft Focus" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open Now Playing" }));
    let nowPlaying = screen.getByRole("article", { name: "First Light" });

    const pauseButton = within(nowPlaying).getByRole("button", { name: "Pause" });
    fireEvent.keyDown(pauseButton, { code: "Space", key: " " });
    expect(within(nowPlaying).getByRole("button", { name: "Pause" })).toBeInTheDocument();
    fireEvent.click(pauseButton);
    expect(within(nowPlaying).getByRole("button", { name: "Play" })).toBeInTheDocument();

    const repeat = within(nowPlaying).getByRole("button", { name: "Repeat off" });
    fireEvent.click(repeat);
    expect(within(nowPlaying).getByRole("button", { name: "Repeat queue" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.change(within(nowPlaying).getByLabelText("Now playing position"), {
      target: { value: "60" },
    });
    expect(container.querySelector("audio")?.currentTime).toBe(60);

    fireEvent.click(within(nowPlaying).getByRole("button", { name: "Play Afterimage" }));
    nowPlaying = await screen.findByRole("article", { name: "Afterimage" });
    expect(within(nowPlaying).getByRole("heading", { name: "Afterimage" })).toBeInTheDocument();
  });

  it("saves favorites locally and opens their internal release page", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    renderApp();

    await screen.findByText("Soft Focus");
    fireEvent.click(screen.getByRole("button", { name: "Open Soft Focus" }));
    const albumPage = await screen.findByRole("article", {
      name: "Soft Focus release details",
    });
    fireEvent.click(within(albumPage).getByRole("button", { name: "Favorite" }));

    expect(window.localStorage.getItem("coda.local-favorites.v1")).toContain("album-1");
    expect(mocks.setFavorite).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Favorites" }));
    expect(await screen.findByText("Local")).toBeInTheDocument();
    expect(screen.getByText("Soft Focus")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Soft Focus" }));
    const reopenedAlbum = await screen.findByRole("article", {
      name: "Soft Focus release details",
    });
    expect(within(reopenedAlbum).getByText("First Light")).toBeInTheDocument();
  });

  it("renders a favorite album tracklist locally when its detail transition applies late", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    renderApp();

    await screen.findByText("Soft Focus");
    fireEvent.click(screen.getByRole("button", { name: "Open Soft Focus" }));
    let albumPage = await screen.findByRole("article", {
      name: "Soft Focus release details",
    });
    fireEvent.click(within(albumPage).getByRole("button", { name: "Favorite" }));
    fireEvent.click(screen.getByRole("button", { name: "Favorites" }));
    await screen.findByText("Local");

    mocks.fetchAlbum.mockClear();
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "startViewTransition",
    );
    let applyTransitionUpdate: (() => void) | undefined;
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: vi.fn((update: () => void) => {
        applyTransitionUpdate = update;
        return { finished: Promise.resolve() };
      }),
    });

    try {
      fireEvent.click(screen.getByRole("button", { name: "Soft Focus" }));
      applyTransitionUpdate?.();

      albumPage = await screen.findByRole("article", {
        name: "Soft Focus release details",
      });
      expect(within(albumPage).getByText("First Light")).toBeInTheDocument();
      expect(within(albumPage).queryByText("Loading tracks…")).not.toBeInTheDocument();
      expect(within(albumPage).getByText("Afterimage")).toBeInTheDocument();
      expect(mocks.fetchAlbum).not.toHaveBeenCalled();
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(document, "startViewTransition", originalDescriptor);
      } else {
        Reflect.deleteProperty(document, "startViewTransition");
      }
    }
  });
});
