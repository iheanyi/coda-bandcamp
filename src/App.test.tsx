import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { compile as compileTailwind } from "@tailwindcss/node";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { albumQueryKey } from "./libraryQueries";
import type { Album, Track } from "./types";

function applyCompiledStyles(
  css: string,
  elements: readonly HTMLElement[],
) {
  const variables = new Map<string, string>();
  for (const match of css.matchAll(/(--[\w-]+):\s*([^;{}]+);/g)) {
    variables.set(match[1], match[2].trim());
  }
  const resolveValue = (rawValue: string) => {
    let value = rawValue.replace(
      /var\((--[\w-]+)(?:,[^)]+)?\)/g,
      (_match, name: string) => variables.get(name) ?? _match,
    );
    const spacingCalculation = value.match(
      /^calc\(([\d.]+)rem \* ([\d.]+)\)$/,
    );
    if (spacingCalculation) {
      value = `${Number(spacingCalculation[1]) * 16 * Number(spacingCalculation[2])}px`;
    } else if (/^[\d.]+rem$/.test(value)) {
      value = `${Number.parseFloat(value) * 16}px`;
    }
    return value;
  };

  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = rule[1].split(",").map((selector) => selector.trim());
    for (const element of elements) {
      const matches = selectors.some((selector) => {
        try {
          return element.matches(selector);
        } catch {
          return false;
        }
      });
      if (!matches) continue;
      for (const declaration of rule[2].matchAll(/([\w-]+):\s*([^;]+);/g)) {
        const property = declaration[1];
        const value = resolveValue(declaration[2].trim());
        if (property === "margin-inline" || property === "padding-inline") {
          const prefix = property.startsWith("margin") ? "margin" : "padding";
          element.style.setProperty(`${prefix}-left`, value);
          element.style.setProperty(`${prefix}-right`, value);
        } else {
          try {
            element.style.setProperty(property, value);
          } catch (cause) {
            // jsdom's cssstyle parser lags valid modern CSS emitted by
            // Tailwind/Base UI. This helper only needs the Coda properties
            // asserted below.
            if (!(cause instanceof SyntaxError)) throw cause;
          }
        }
      }
    }
  }
}

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
  it("centers the connection copy without a decorative status dot", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    renderApp();

    const connectionHeading = await screen.findByText("Bandcamp synced");
    const connectionCopy = connectionHeading.parentElement;
    const connectionFooter = connectionCopy?.parentElement;
    if (!connectionCopy || !connectionFooter) {
      throw new Error("Expected the connection copy inside the sidebar footer");
    }

    const stylesPath = resolve("src/styles.css");
    const compiler = await compileTailwind(
      await readFile(stylesPath, "utf8"),
      {
        base: resolve("src"),
        from: stylesPath,
        onDependency: () => undefined,
      },
    );
    const candidates = Array.from(document.querySelectorAll("*"))
      .flatMap((element) => Array.from(element.classList));
    applyCompiledStyles(compiler.build(candidates), [
      connectionCopy,
      connectionFooter,
    ]);

    expect(getComputedStyle(connectionFooter).justifyContent).toBe("center");
    expect(getComputedStyle(connectionCopy).textAlign).toBe("center");
    expect(connectionCopy.previousElementSibling).toBeNull();
  });

  it("announces a spinner while the initial collection view is loading", async () => {
    const request = deferred<Album[]>();
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockReturnValue(request.promise);
    renderApp();

    const loadingStatus = await screen.findByRole("status", {
      name: "Loading your collection",
    });
    expect(loadingStatus).toHaveAttribute("data-slot", "spinner");

    await act(async () => request.resolve([album]));
  });

  it("dismisses connection settings with Escape and restores trigger focus", async () => {
    renderApp();

    const trigger = await screen.findByRole("button", {
      name: "Connection settings",
    });
    trigger.focus();
    fireEvent.click(trigger);
    expect(await screen.findByRole("dialog", {
      name: "Bring in your collection",
    })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByRole("dialog", {
        name: "Bring in your collection",
      })).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });

  it("rejects Escape and outside dismissal while Bandcamp connection is busy", async () => {
    mocks.connectBandcamp.mockReturnValue(new Promise(() => undefined));
    renderApp();

    fireEvent.click(await screen.findByRole("button", { name: "Connect Bandcamp" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Bring in your collection",
    });
    fireEvent.change(within(dialog).getByLabelText("Subsonic username"), {
      target: { value: "generated-user" },
    });
    fireEvent.change(within(dialog).getByLabelText("Subsonic password"), {
      target: { value: "generated-password" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Connect Bandcamp" }));
    expect(await within(dialog).findByRole("button", {
      name: "Connecting securely…",
    })).toBeDisabled();

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.pointerDown(document.body);
    fireEvent.mouseDown(document.body);
    fireEvent.click(document.body);

    expect(screen.getByRole("dialog", {
      name: "Bring in your collection",
    })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeDisabled();
  });

  it("rejects Escape and outside dismissal while Last.fm authorization is busy", async () => {
    let resolveAuthorization!: (authorization: {
      authorizationUrl: string;
      token: string;
    }) => void;
    const pendingAuthorization = new Promise<{
      authorizationUrl: string;
      token: string;
    }>((resolve) => {
      resolveAuthorization = resolve;
    });
    mocks.beginLastFmAuthorization.mockReturnValue(pendingAuthorization);
    renderApp();

    fireEvent.click(await screen.findByRole("button", {
      name: "Connection settings",
    }));
    const dialog = await screen.findByRole("dialog", {
      name: "Bring in your collection",
    });
    fireEvent.click(within(dialog).getByRole("button", {
      name: "Connect Last.fm",
    }));
    expect(await within(dialog).findByRole("button", {
      name: "Opening Last.fm…",
    })).toBeDisabled();

    try {
      fireEvent.keyDown(document, { key: "Escape" });
      fireEvent.pointerDown(document.body);
      fireEvent.mouseDown(document.body);
      fireEvent.click(document.body);

      expect(screen.getByRole("dialog", {
        name: "Bring in your collection",
      })).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "Close" }))
        .toBeDisabled();
    } finally {
      await act(async () => {
        resolveAuthorization({
          authorizationUrl:
            "https://www.last.fm/api/auth/?api_key=key&token=deferred-token",
          token: "deferred-token",
        });
        await pendingAuthorization;
      });
    }
  });

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

  it("exposes the library scroll owner for virtualized views", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    renderApp();

    await screen.findByText("Soft Focus");
    expect(
      document.querySelector("[data-coda-library-scroll]"),
    ).toBeInstanceOf(HTMLElement);
  });

  it("wires collection sort and overflow-genre native selections to rendered results", async () => {
    const collection = [
      { artist: "Zulu", genre: "Ambient", title: "Zulu Ambient" },
      { artist: "Cobalt", genre: "Electronic", title: "Cobalt Electronic" },
      { artist: "Delta", genre: "Folk", title: "Delta Folk" },
      { artist: "Echo", genre: "Jazz", title: "Echo Jazz" },
      { artist: "Foxtrot", genre: "Metal", title: "Foxtrot Metal" },
      { artist: "Aardvark", genre: "Rock", title: "Aardvark Rock" },
    ].map((metadata, index): Album => ({
      ...album,
      ...metadata,
      id: `album-filter-${index}`,
    }));
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue(collection);
    renderApp();

    await screen.findByText("Zulu Ambient");
    const sort = screen.getByRole("combobox", {
      name: "Sort collection",
    });
    fireEvent.change(sort, { target: { value: "artist" } });
    expect(sort).toHaveValue("artist");
    await waitFor(() =>
      expect(screen.getAllByRole("button", {
        name: /^Open /,
      })[0]).toHaveAccessibleName("Open Aardvark Rock"),
    );

    const moreGenres = screen.getByRole("combobox", {
      name: "More collection genres",
    });
    expect(within(moreGenres).getByRole("option", {
      name: "Rock",
    })).toBeInTheDocument();
    fireEvent.change(moreGenres, { target: { value: "Rock" } });

    expect(await screen.findByRole("button", { name: "Rock" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", {
      name: "Open Aardvark Rock",
    })).toBeInTheDocument();
    expect(screen.queryByRole("button", {
      name: "Open Zulu Ambient",
    })).not.toBeInTheDocument();
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
    expect(disconnectButton).toBeEnabled();
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
    expect(await within(dialog).findByRole("alert"))
      .toHaveTextContent("Vault unavailable");

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

  it("applies compact-player position and volume slider changes immediately", async () => {
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

    await screen.findByRole("button", { name: "Open Now Playing" });
    const audio = container.querySelector("audio");
    expect(audio).not.toBeNull();
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

    const positionRoot = screen.getByRole("group", {
      name: "Track position",
    });
    const positionControl = positionRoot.querySelector<HTMLElement>(
      "[data-base-ui-slider-control]",
    );
    const positionThumb = positionRoot.querySelector<HTMLElement>(
      "[data-slot=slider-thumb]",
    );
    const positionTrack = positionRoot.querySelector<HTMLElement>(
      "[data-slot=slider-track]",
    );
    expect(positionControl).not.toBeNull();
    expect(positionThumb).not.toBeNull();
    expect(positionTrack).not.toBeNull();
    const stylesPath = resolve("src/styles.css");
    const compiler = await compileTailwind(
      await readFile(stylesPath, "utf8"),
      {
        base: resolve("src"),
        from: stylesPath,
        onDependency: () => undefined,
      },
    );
    const candidates = Array.from(document.querySelectorAll("*"))
      .flatMap((element) => Array.from(element.classList));
    applyCompiledStyles(compiler.build(candidates), [
      positionControl!,
      positionTrack!,
    ]);
    expect(getComputedStyle(positionControl!).height).toBe("20px");
    expect(getComputedStyle(positionTrack!).height).toBe("4px");
    vi.spyOn(positionControl!, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(0, 0, 100, 20));
    vi.spyOn(positionThumb!, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(18.43, 5, 10, 10));
    fireEvent.pointerDown(positionControl!, {
      button: 0,
      buttons: 1,
      clientX: 35,
      clientY: 10,
      pointerId: 1,
      pointerType: "mouse",
    });
    await waitFor(() => expect(audio!.currentTime).toBe(60));
    fireEvent.pointerUp(document, {
      button: 0,
      buttons: 0,
      clientX: 35,
      clientY: 10,
      pointerId: 1,
      pointerType: "mouse",
    });
    fireEvent.pointerDown(positionControl!, {
      button: 0,
      buttons: 1,
      clientX: 35,
      clientY: 10,
      pointerId: 2,
      pointerType: "mouse",
    });
    fireEvent.pointerMove(document, {
      buttons: 1,
      clientX: 50,
      clientY: 10,
      pointerId: 2,
      pointerType: "mouse",
    });
    await waitFor(() => expect(audio!.currentTime).toBe(90));
    fireEvent.pointerUp(document, {
      button: 0,
      buttons: 0,
      clientX: 50,
      clientY: 10,
      pointerId: 2,
      pointerType: "mouse",
    });

    const volume = screen.getByRole("slider", { name: "Volume" });
    const volumeRoot = screen.getByRole("group", { name: "Volume" });
    const compactWidthStyles = document.createElement("style");
    compactWidthStyles.textContent = `
      .w-20 { width: 5rem; }
      .data-horizontal\\:w-full:where([data-orientation="horizontal"]) {
        width: 100%;
      }
    `;
    document.head.append(compactWidthStyles);
    try {
      expect(getComputedStyle(volumeRoot).width).toBe("5rem");
    } finally {
      compactWidthStyles.remove();
    }

    volume.focus();
    fireEvent.keyDown(volume, { key: "ArrowRight" });
    await waitFor(() => expect(audio!.volume).toBeCloseTo(0.45));

    const volumeControl = volumeRoot.querySelector<HTMLElement>(
      "[data-base-ui-slider-control]",
    );
    const volumeThumb = volumeRoot.querySelector<HTMLElement>(
      "[data-slot=slider-thumb]",
    );
    expect(volumeControl).not.toBeNull();
    expect(volumeThumb).not.toBeNull();
    vi.spyOn(volumeControl!, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(0, 0, 100, 20));
    vi.spyOn(volumeThumb!, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(40.5, 5, 10, 10));
    fireEvent.pointerDown(volumeControl!, {
      button: 0,
      buttons: 1,
      clientX: 36.5,
      clientY: 10,
      pointerId: 1,
      pointerType: "mouse",
    });
    await waitFor(() => expect(audio!.volume).toBeCloseTo(0.35));
    fireEvent.pointerUp(document, {
      button: 0,
      buttons: 0,
      clientX: 36.5,
      clientY: 10,
      pointerId: 1,
      pointerType: "mouse",
    });

    fireEvent.pointerDown(volumeControl!, {
      button: 0,
      buttons: 1,
      clientX: 72,
      clientY: 10,
      pointerId: 1,
      pointerType: "mouse",
    });
    fireEvent.pointerMove(document, {
      buttons: 1,
      clientX: 36.5,
      clientY: 10,
      pointerId: 1,
      pointerType: "mouse",
    });
    fireEvent.pointerUp(document, {
      button: 0,
      buttons: 0,
      clientX: 36.5,
      clientY: 10,
      pointerId: 1,
      pointerType: "mouse",
    });
    await waitFor(() => expect(audio!.volume).toBeCloseTo(0.35));
  });

  it("contains compact metadata and keeps the pending album action named", async () => {
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
      const artistControl = within(player).getByRole("button", {
        name: longArtist,
      });
      const albumControl = within(player).getByRole("button", {
        name: longAlbumTitle,
      });
      expect(artistControl).toHaveClass("min-w-0", "max-w-[46%]", "truncate");
      expect(albumControl).toHaveClass("min-w-0", "max-w-[46%]", "truncate");
      expect(artistControl).toHaveAttribute("title", longArtist);
      expect(albumControl).toHaveAttribute("title", longAlbumTitle);

      queryClient.removeQueries({ queryKey: albumQueryKey(longAlbum.id) });
      fireEvent.click(albumControl);

      const pendingControl = within(player).getByRole("button", {
        name: `Loading album ${longAlbumTitle}`,
      });
      expect(pendingControl).toBeDisabled();
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

    const player = screen.getByRole("contentinfo");
    const previous = within(player).getByRole("button", { name: "Previous" });
    const next = within(player).getByRole("button", { name: "Next" });
    const audio = container.querySelector("audio")!;

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
        streamUrl: "https://example.test/vanishing-point.mp3",
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
    const user = userEvent.setup();
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    renderApp();

    await screen.findByText("Soft Focus");
    const libraryPane = screen.getByRole("main");
    const player = screen.getByRole("contentinfo");
    expect(screen.queryByRole("dialog", { name: "Queue" }))
      .not.toBeInTheDocument();
    const showQueue = screen.getByRole("button", { name: "Show queue" });
    expect(showQueue)
      .toHaveAttribute("aria-pressed", "false");
    showQueue.focus();
    expect(showQueue).toHaveFocus();

    await user.keyboard("{Enter}");
    const queueDrawer = await waitFor(() => {
      const popup = document.querySelector<HTMLElement>(
        '[data-slot="drawer-popup"]',
      );
      expect(popup).toBeInstanceOf(HTMLElement);
      return popup!;
    });
    expect(queueDrawer).toHaveAttribute("role", "dialog");
    expect(queueDrawer).toHaveAccessibleName("Queue");
    expect(showQueue).toHaveAttribute("aria-haspopup", "dialog");
    expect(queueDrawer).toHaveAttribute("data-swipe-direction", "right");
    await waitFor(() => expect(queueDrawer).toHaveFocus());
    expect(queueDrawer).toHaveAttribute("data-slot", "drawer-popup");
    expect(document.querySelector(
      '[data-slot="drawer-viewport"][data-modal="false"]',
    )).toBeInTheDocument();
    await user.click(within(player).getByRole("button", { name: "Mute" }));
    expect(within(player).getByRole("button", { name: "Unmute" }))
      .toBeInTheDocument();
    expect(queueDrawer).toBeVisible();
    await user.click(within(player).getByRole("button", { name: "Unmute" }));
    expect(within(player).getByRole("slider", { name: "Volume" })).toBeEnabled();
    expect(screen.getByRole("region", { name: "Upcoming tracks" }))
      .toBeInTheDocument();
    const hideQueue = screen.getByRole("button", { name: "Hide queue" });
    expect(hideQueue).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("main")).toBe(libraryPane);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Queue" }))
      .not.toBeInTheDocument();
    expect(document.querySelector('[data-slot="drawer-popup"]'))
      .not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show queue" }))
      .toHaveAttribute("aria-pressed", "false");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Show queue" })).toHaveFocus(),
    );
    expect(screen.getByRole("main")).toBe(libraryPane);
    await user.click(screen.getByRole("button", { name: "Show queue" }));
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Queue" }))
        .toHaveFocus(),
    );
    const keyboardHideQueue = screen.getByRole("button", {
      name: "Hide queue",
    });
    keyboardHideQueue.focus();
    await user.keyboard(" ");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Show queue" })).toHaveFocus(),
    );
  });

  it("restores queue focus to the active Now Playing control", async () => {
    const user = userEvent.setup();
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    renderApp();

    await screen.findByText("Soft Focus");
    await user.click(screen.getByRole("button", { name: "Play Soft Focus" }));

    const compactQueueControl = await screen.findByRole("button", {
      name: "Show queue",
    });
    compactQueueControl.focus();
    await user.click(compactQueueControl);
    expect(await screen.findByRole("dialog", { name: "Queue" }))
      .toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open Now Playing" }));
    const nowPlaying = await screen.findByRole("article", {
      name: "First Light",
    });
    expect(within(nowPlaying).getAllByRole("button", {
      name: "Hide queue",
    })).toHaveLength(1);
    expect(within(nowPlaying).queryByRole("button", {
      name: "Hide full queue",
    })).not.toBeInTheDocument();

    await user.keyboard("{Escape}");
    const nowPlayingQueueControl = within(nowPlaying).getByRole("button", {
      name: "Show queue",
    });
    await waitFor(() => expect(nowPlayingQueueControl).toHaveFocus());

    await user.click(nowPlayingQueueControl);
    const reopenedQueue = await screen.findByRole("dialog", { name: "Queue" });
    await waitFor(() => expect(reopenedQueue).toHaveFocus());
    const hideQueueControl = within(nowPlaying).getByRole("button", {
      name: "Hide queue",
    });
    hideQueueControl.focus();
    expect(hideQueueControl).toHaveFocus();
    await user.keyboard(" ");
    await waitFor(() => expect(nowPlayingQueueControl).toHaveFocus());
  });

  it("keeps the rendered queue opaque and contains long metadata within one gutter", async () => {
    const longTitle =
      "A deliberately long Now Playing title that must yield before the queue edge";
    const restoredTrack = {
      ...tracks[0],
      title: longTitle,
    };
    const { streamUrl: _streamUrl, ...restoredTrackState } = restoredTrack;
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    mocks.loadPlayerState.mockResolvedValue({
      version: 1,
      savedAt: Date.now(),
      queue: [restoredTrackState],
      currentIndex: 0,
      positionSeconds: 0,
      volume: 0.72,
      repeatMode: "off",
      queueOpen: true,
    });
    renderApp();

    const panel = await screen.findByRole("dialog", {
      name: "Queue",
    });
    const stylesPath = resolve("src/styles.css");
    const compiler = await compileTailwind(
      await readFile(stylesPath, "utf8"),
      {
        base: resolve("src"),
        from: stylesPath,
        onDependency: () => undefined,
      },
    );
    const candidates = Array.from(document.querySelectorAll("*"))
      .flatMap((element) => Array.from(element.classList));
    const header = panel.querySelector<HTMLElement>(
      '[data-slot="drawer-header"]',
    );
    const currentTitle = within(panel).getByRole("button", { name: longTitle });
    const currentMetadata = currentTitle.parentElement;
    const nowPlayingCard = currentMetadata?.parentElement?.parentElement;
    const queueRegion = within(panel).getByRole("region", {
      name: "Upcoming tracks",
    });
    const emptyCopy = within(queueRegion).getByText(
      /Not sure what comes next|Add another album or track/,
    );
    const emptyState = emptyCopy.parentElement;
    const footer = panel.querySelector<HTMLElement>(
      '[data-slot="drawer-footer"]',
    );

    applyCompiledStyles(compiler.build(candidates), [
      panel,
      currentMetadata!,
      currentTitle,
      emptyCopy,
      nowPlayingCard!,
      queueRegion,
      emptyState!,
      header!,
      footer as HTMLElement,
    ]);

    expect(getComputedStyle(panel).backgroundColor).toBe("rgb(21, 23, 25)");
    expect(getComputedStyle(currentMetadata!).flexBasis).toBe("0px");
    expect(getComputedStyle(currentMetadata!).flexGrow).toBe("1");
    expect(getComputedStyle(currentMetadata!).overflow).toBe("hidden");
    expect(getComputedStyle(currentTitle).textOverflow).toBe("ellipsis");
    expect(getComputedStyle(currentTitle).whiteSpace).toBe("nowrap");
    expect(getComputedStyle(emptyCopy).maxWidth).toBe("256px");

    const gutter = Number.parseFloat(getComputedStyle(nowPlayingCard!).marginLeft);
    const recommendationGutter =
      Number.parseFloat(getComputedStyle(queueRegion).paddingLeft) +
      Number.parseFloat(getComputedStyle(emptyState!).paddingLeft);
    expect(gutter).toBe(12);
    expect(recommendationGutter).toBe(gutter);
    expect(Number.parseFloat(getComputedStyle(header!).paddingLeft)).toBe(gutter);
    expect(Number.parseFloat(getComputedStyle(footer!).paddingLeft)).toBe(gutter);
  });

  it("reveals a queue remove control when it receives keyboard focus", async () => {
    const restoredQueue = tracks.map(
      ({ streamUrl: _streamUrl, ...track }) => track,
    );
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    mocks.loadPlayerState.mockResolvedValue({
      version: 1,
      savedAt: Date.now(),
      queue: restoredQueue,
      currentIndex: 0,
      positionSeconds: 0,
      volume: 0.72,
      repeatMode: "off",
      queueOpen: true,
    });
    renderApp();

    const remove = await screen.findByRole("button", {
      name: "Remove Afterimage",
    });
    const stylesPath = resolve("src/styles.css");
    const compiler = await compileTailwind(
      await readFile(stylesPath, "utf8"),
      {
        base: resolve("src"),
        from: stylesPath,
        onDependency: () => undefined,
      },
    );
    const candidates = Array.from(document.querySelectorAll("*"))
      .flatMap((element) => Array.from(element.classList));
    applyCompiledStyles(compiler.build(candidates), [remove]);
    expect(["0", "0%"]).not.toContain(getComputedStyle(remove).opacity);

    remove.focus();
    expect(remove).toHaveFocus();
    applyCompiledStyles(compiler.build(candidates), [remove]);
    expect(["1", "100%"]).toContain(getComputedStyle(remove).opacity);

    fireEvent.click(remove);
    await waitFor(() =>
      expect(screen.queryByRole("button", {
        name: "Remove Afterimage",
      })).not.toBeInTheDocument(),
    );
    expect(within(screen.getByRole("region", {
      name: "Upcoming tracks",
    })).queryByText("Afterimage")).not.toBeInTheDocument();
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
    expect(screen.queryByRole("dialog", { name: "Queue" }))
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

  it("keeps collection category counts visually subordinate to their labels", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album, single]);
    renderApp();

    const releasesCategory = await screen.findByTitle("Browse every purchase");
    const countBadge = releasesCategory.querySelector<HTMLElement>(
      "[data-slot=badge]",
    );
    if (!countBadge) {
      throw new Error("Expected the releases category to include its count badge");
    }

    const stylesPath = resolve("src/styles.css");
    const compiler = await compileTailwind(
      await readFile(stylesPath, "utf8"),
      {
        base: resolve("src"),
        from: stylesPath,
        onDependency: () => undefined,
      },
    );
    const candidates = Array.from(document.querySelectorAll("*"))
      .flatMap((element) => Array.from(element.classList));
    applyCompiledStyles(compiler.build(candidates), [countBadge]);

    expect(countBadge).toHaveAttribute("data-size", "compact");
    expect(getComputedStyle(countBadge).height).toBe("16px");
    expect(getComputedStyle(countBadge).fontSize).toBe("10px");
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
    expect(screen.getByRole("slider", { name: "Track position" }))
      .toHaveValue("42");
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
    const queuePanel = screen.getByRole("dialog", { name: "Queue" });
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
    expect(within(singlePage).getByText("#")).toBeVisible();
    expect(within(singlePage).getByTitle("Duration")).toBeVisible();
    const singleTrackControl = within(singlePage).getByRole("button", {
      name: "Play Streetlight",
    });
    expect(within(singleTrackControl.parentElement!).getByText("2:44"))
      .toBeVisible();
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

  it.each([
    ["Play all"],
    ["Shuffle"],
    ["Add all"],
  ] as const)(
    "scopes %s to the selected artist on a compilation",
    async (actionName) => {
      const guestArtist = "Guest Artist";
      const compilationTrack = {
        ...tracks[0],
        id: "track-compilation-guest",
        title: "Guest Selection",
        artist: guestArtist,
        albumArtist: "Various Artists",
        album: "Night Compendium",
        albumId: "album-compilation",
      };
      const otherTrack = {
        ...tracks[1],
        id: "track-compilation-other",
        title: "Other Selection",
        artist: "Other Artist",
        albumArtist: "Various Artists",
        album: "Night Compendium",
        albumId: "album-compilation",
      };
      const compilationTracks = [compilationTrack, otherTrack];
      const compilation = {
        ...album,
        id: "album-compilation",
        title: "Night Compendium",
        artist: "Various Artists",
        tracks: compilationTracks,
        songCount: compilationTracks.length,
        duration: compilationTracks.reduce(
          (total, track) => total + track.duration,
          0,
        ),
      };
      mocks.hasConnection.mockResolvedValue(true);
      mocks.fetchLibrary.mockResolvedValue([compilation]);
      mocks.fetchAlbum.mockResolvedValue(compilationTracks);
      renderApp();

      await screen.findByText("Night Compendium");
      fireEvent.click(screen.getByRole("button", {
        name: "Open Night Compendium",
      }));
      const albumPage = await screen.findByRole("article", {
        name: "Night Compendium release details",
      });
      fireEvent.click(within(albumPage).getByRole("button", {
        name: guestArtist,
      }));

      const heading = await screen.findByRole("heading", { name: guestArtist });
      const artistHero = heading.closest("section");
      if (!artistHero) {
        throw new Error("Expected the artist heading in its hero");
      }
      expect(artistHero).toHaveTextContent("1 release · 1 track · 3:00");
      expect(screen.getByRole("button", { name: "Open Night Compendium" }))
        .toBeInTheDocument();
      fireEvent.click(within(artistHero).getByRole("button", {
        name: actionName,
      }));

      const player = await screen.findByRole("contentinfo");
      await within(player).findByText("Guest Selection");
      expect(within(player).queryByText("Other Selection"))
        .not.toBeInTheDocument();
      expect(within(player).getByRole("button", { name: "Next" }))
        .toBeDisabled();
    },
  );

  it("keeps artist navigation selected while a deferred search clears", async () => {
    const unrelatedAlbum = {
      ...album,
      id: "album-unrelated",
      title: "Unrelated Echo",
      artist: "Other Artist",
      tracks: [tracks[1]],
    };
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album, unrelatedAlbum]);
    renderApp();

    await screen.findByText("Soft Focus");
    fireEvent.click(screen.getByRole("button", { name: "Play Soft Focus" }));
    const player = await screen.findByRole("contentinfo");
    const search = screen.getByPlaceholderText("Search your collection");
    fireEvent.change(search, { target: { value: "Unrelated Echo" } });
    await screen.findByRole("button", { name: "Open Unrelated Echo" });

    fireEvent.click(within(player).getByRole("button", {
      name: "Night Archive",
    }));

    expect(await screen.findByRole("heading", { name: "Night Archive" }))
      .toBeInTheDocument();
    expect(search).toHaveValue("");
    expect(screen.getByRole("button", { name: "Open Soft Focus" }))
      .toBeInTheDocument();
  });

  it("applies a new search entered from an artist page", async () => {
    const unrelatedAlbum = {
      ...album,
      id: "album-unrelated",
      title: "Unrelated Echo",
      artist: "Other Artist",
      tracks: [tracks[1]],
    };
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album, unrelatedAlbum]);
    renderApp();

    await screen.findByText("Soft Focus");
    fireEvent.click(screen.getByTitle("Browse Night Archive"));
    expect(await screen.findByRole("heading", { name: "Night Archive" }))
      .toBeInTheDocument();

    fireEvent.change(
      screen.getByPlaceholderText("Search your collection"),
      { target: { value: "Unrelated Echo" } },
    );

    expect(await screen.findByText("Other Artist")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Night Archive" }))
      .not.toBeInTheDocument();
  });

  it("prefetches a deliberate album hover and opens cached tracks immediately", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    const { queryClient } = renderApp();

    await screen.findByText("Soft Focus");
    const openButton = screen.getByRole("button", { name: "Open Soft Focus" });
    const albumCard = openButton.closest("article");
    if (!albumCard) throw new Error("Expected the album control inside a card");
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

  it("keeps album track rows on the exact 56px rhythm without content overflow", async () => {
    const longTitle = "First Light Across the Entire Midnight Horizon";
    const longArtist = "Sweeps and the Extended Ensemble of Endless Echoes";
    const longTrack = {
      ...tracks[0],
      id: "track-long-metadata",
      albumId: "album-long-metadata",
      title: longTitle,
      artist: longArtist,
    };
    const longMetadataAlbum = {
      ...album,
      id: "album-long-metadata",
      tracks: [longTrack],
      songCount: 1,
      duration: longTrack.duration,
    };
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([longMetadataAlbum]);
    mocks.fetchAlbum.mockResolvedValue([longTrack]);
    renderApp();

    await screen.findByText("Soft Focus");
    fireEvent.click(screen.getByRole("button", { name: "Open Soft Focus" }));
    const albumPage = await screen.findByRole("article", {
      name: "Soft Focus release details",
    });
    const playTrack = within(albumPage).getByRole("button", {
      name: `Play ${longTitle}`,
    });
    const trackRow = playTrack.parentElement;
    if (!trackRow) throw new Error("Expected the play control inside a track row");

    expect(trackRow).toHaveClass(
      "h-14",
      "grid-cols-[2.5rem_minmax(0,1fr)_3.5rem_7rem]",
    );
    expect(trackRow).not.toHaveClass("min-h-14");
    const stylesPath = resolve("src/styles.css");
    const compiler = await compileTailwind(
      await readFile(stylesPath, "utf8"),
      {
        base: resolve("src"),
        from: stylesPath,
        onDependency: () => undefined,
      },
    );
    const candidates = Array.from(document.querySelectorAll("*"))
      .flatMap((element) => Array.from(element.classList));
    applyCompiledStyles(compiler.build(candidates), [trackRow]);
    expect(getComputedStyle(trackRow).height).toBe("56px");

    const titleControl = within(trackRow).getByRole("button", {
      name: longTitle,
    });
    expect(titleControl.parentElement).toHaveClass("min-w-0", "overflow-hidden");
    expect(titleControl).toHaveClass(
      "min-w-0",
      "max-w-full",
      "overflow-hidden",
      "focus-visible:-outline-offset-2",
    );
    titleControl.focus();
    expect(titleControl).toHaveFocus();
    const artistControl = within(trackRow).getByRole("button", {
      name: longArtist,
    });
    expect(artistControl).toHaveClass(
      "truncate",
      "focus-visible:-outline-offset-2",
    );
    artistControl.focus();
    expect(artistControl).toHaveFocus();
    expect(within(trackRow).getByRole("button", {
      name: `Add ${longTitle} to queue`,
    }).parentElement).toHaveClass(
      "grid-cols-[repeat(3,2rem)]",
      "justify-end",
    );

    fireEvent.click(playTrack);
    expect(trackRow).toHaveClass("h-14", "bg-primary/[0.075]");
  });

  it("contains unbroken album and Now Playing metadata", async () => {
    const longAlbumTitle = "AlbumTitle".repeat(64);
    const longTrackTitle = "TrackTitle".repeat(64);
    const longArtist = "ArtistName".repeat(64);
    const longTrack = {
      ...tracks[0],
      id: "track-unbroken-metadata",
      title: longTrackTitle,
      artist: longArtist,
      album: longAlbumTitle,
      albumId: "album-unbroken-metadata",
    };
    const longAlbum = {
      ...album,
      id: "album-unbroken-metadata",
      title: longAlbumTitle,
      artist: longArtist,
      tracks: [longTrack],
      songCount: 1,
      duration: longTrack.duration,
    };
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([longAlbum]);
    mocks.fetchAlbum.mockResolvedValue([longTrack]);
    renderApp();

    await screen.findByText(longAlbumTitle);
    fireEvent.click(screen.getByRole("button", {
      name: `Open ${longAlbumTitle}`,
    }));
    const albumPage = await screen.findByRole("article", {
      name: `${longAlbumTitle} release details`,
    });
    const albumHeading = within(albumPage).getByRole("heading", {
      name: longAlbumTitle,
    });
    const artistControl = within(albumPage).getAllByRole("button", {
      name: longArtist,
    }).find((control) => control.getAttribute("title") === longArtist);
    if (!artistControl) {
      throw new Error("Expected the album hero artist control");
    }
    expect(albumHeading).toHaveClass("wrap-anywhere");
    expect(albumHeading).toHaveAttribute("title", longAlbumTitle);
    expect(artistControl).toHaveClass("max-w-full", "truncate");
    expect(artistControl).toHaveAttribute("title", longArtist);

    fireEvent.click(within(albumPage).getByRole("button", {
      name: "Play single",
    }));
    fireEvent.click(await screen.findByRole("button", {
      name: "Open Now Playing",
    }));
    const nowPlaying = await screen.findByRole("article", {
      name: longTrackTitle,
    });
    const trackHeading = within(nowPlaying).getByRole("heading", {
      name: longTrackTitle,
    });
    expect(trackHeading).toHaveClass("wrap-anywhere");
    expect(trackHeading).toHaveAttribute("title", longTrackTitle);
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

  it("shows a bounded accessible spinner while a cold album loads", async () => {
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
    const loadingStatus = within(trackList).getByRole("status", {
      name: "Loading album tracks",
    });
    expect(loadingStatus).toHaveAttribute("data-slot", "spinner");
    expect(loadingStatus.parentElement).toHaveClass("min-h-44");

    await act(async () => request.resolve(tracks));
  });

  it("opens a cold album into one visible detail loader without snapshotting a blank handoff", async () => {
    const request = deferred<Track[]>();
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    mocks.fetchAlbum.mockReturnValueOnce(request.promise);
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "startViewTransition",
    );
    const startViewTransition = vi.fn((_update: () => void) => ({
      finished: Promise.resolve(),
    }));
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    try {
      renderApp();

      await screen.findByText("Soft Focus");
      fireEvent.click(screen.getByRole("button", { name: "Open Soft Focus" }));

      const albumPage = screen.getByRole("article", {
        name: "Soft Focus release details",
      });
      expect(startViewTransition).not.toHaveBeenCalled();
      expect(screen.getAllByRole("status")).toHaveLength(1);
      expect(within(albumPage).getByRole("status", {
        name: "Loading album tracks",
      })).toBeVisible();
      expect(screen.queryByRole("status", {
        name: "Loading Soft Focus",
      })).not.toBeInTheDocument();
    } finally {
      await act(async () => request.resolve(tracks));
      if (originalDescriptor) {
        Object.defineProperty(document, "startViewTransition", originalDescriptor);
      } else {
        Reflect.deleteProperty(document, "startViewTransition");
      }
    }
  });

  it("keeps the page transition for a prefetched album without adding a loader", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "startViewTransition",
    );
    let applyTransitionUpdate: (() => void) | undefined;
    const startViewTransition = vi.fn((update: () => void) => {
      applyTransitionUpdate = update;
      return { finished: Promise.resolve() };
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    try {
      const { queryClient } = renderApp();

      await screen.findByText("Soft Focus");
      queryClient.setQueryData(albumQueryKey(album.id), tracks);
      const openButton = screen.getByRole("button", {
        name: "Open Soft Focus",
      });

      fireEvent.click(openButton);

      expect(startViewTransition).toHaveBeenCalledOnce();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(screen.queryByRole("article", {
        name: "Soft Focus release details",
      })).not.toBeInTheDocument();

      await act(async () => {
        applyTransitionUpdate?.();
        await Promise.resolve();
      });
      const albumPage = screen.getByRole("article", {
        name: "Soft Focus release details",
      });
      expect(within(albumPage).getByText("First Light")).toBeVisible();
      expect(within(albumPage).queryByRole("status")).not.toBeInTheDocument();
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(document, "startViewTransition", originalDescriptor);
      } else {
        Reflect.deleteProperty(document, "startViewTransition");
      }
    }
  });

  it("announces cold album track hydration until the fetched tracks arrive", async () => {
    const summaryAlbum: Album = {
      ...album,
      tracks: undefined,
    };
    let resolveAlbumTracks!: (value: Track[]) => void;
    let albumTracksSettled = false;
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([summaryAlbum]);
    mocks.fetchAlbum.mockReturnValue(new Promise((resolve) => {
      resolveAlbumTracks = resolve;
    }));
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
      renderApp();

      await screen.findByText("Soft Focus");
      fireEvent.click(screen.getByRole("button", { name: "Open Soft Focus" }));
      await act(async () => {
        applyTransitionUpdate?.();
        await Promise.resolve();
      });

      const albumPage = await screen.findByRole("article", {
        name: "Soft Focus release details",
      });
      const loadingStatus = await within(albumPage).findByRole("status", {
        name: "Loading album tracks",
      });
      expect(within(albumPage).getByText("Loading tracks…")).toBeVisible();
      expect(loadingStatus).toHaveAttribute("data-slot", "spinner");
      expect(within(albumPage).getByLabelText("Track list"))
        .toHaveAttribute("aria-busy", "true");

      await act(async () => {
        albumTracksSettled = true;
        resolveAlbumTracks(tracks);
        await Promise.resolve();
      });

      await waitFor(() =>
        expect(within(albumPage).queryByRole("status", {
          name: "Loading album tracks",
        })).not.toBeInTheDocument(),
      );
      expect(within(albumPage).getByLabelText("Track list"))
        .not.toHaveAttribute("aria-busy");
      expect(within(albumPage).getByText("First Light")).toBeInTheDocument();
    } finally {
      try {
        if (!albumTracksSettled) {
          await act(async () => {
            albumTracksSettled = true;
            resolveAlbumTracks(tracks);
            await Promise.resolve();
          });
        }
      } finally {
        if (originalDescriptor) {
          Object.defineProperty(document, "startViewTransition", originalDescriptor);
        } else {
          Reflect.deleteProperty(document, "startViewTransition");
        }
      }
    }
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

    const nowPlayingPosition = nowPlaying.querySelector<HTMLInputElement>(
      'input[type="range"][aria-label="Now playing position"]',
    );
    expect(nowPlayingPosition).not.toBeNull();
    fireEvent.change(nowPlayingPosition!, {
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
