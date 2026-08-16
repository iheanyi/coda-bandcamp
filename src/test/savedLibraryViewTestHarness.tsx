import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterContextProvider,
  RouterProvider,
  useRouter,
} from "@tanstack/react-router";
import type { InvokeArgs } from "@tauri-apps/api/core";
import { render, type RenderResult } from "@testing-library/react";
import { type ReactNode, useRef, useState } from "react";
import { afterEach, beforeEach, vi } from "vitest";

import { CodaMotionProvider } from "@/MotionProvider";
import type { AppUpdaterController } from "@/appUpdaterController";
import { clearCoverArtRendererState } from "@/coverArtSource";
import { resetDetailNavigation } from "@/detailNavigation";
import { createLibrarySessionController } from "@/features/library-session";
import type { SavedLibraryRuntimeValue } from "@/features/saved-library";
import { SavedLibraryRuntimeProvider } from "@/features/saved-library";
import { AddToPlaylistDialog } from "@/features/saved-library/AddToPlaylistDialog";
import { PersistentAppOverlays } from "@/features/settings/PersistentAppOverlays";
import { usePersistentOverlaysController } from "@/features/settings/usePersistentOverlaysController";
import { createCodaMemoryRouter } from "@/router";
import { Route as RootRoute } from "@/routes/__root";
import type { OwnDataRecord, OwnDataValue } from "@/ownData";
import {
  installTauriEventPluginTestInternals,
  readTauriInvokeArguments,
  tauriBoolean,
  tauriNumber,
  tauriNumberList,
  tauriString,
  tauriStringList,
} from "@/test/tauriInvoke";
import type {
  LocalFavoriteCollection,
  PlaylistDetail,
  PlaylistSummary,
  PlaylistUpdateInput,
  RadioShow,
  Track,
} from "@/types";

type CoverArtOrderingReceipt = Readonly<{ sequence: string }>;

export const mocks = {
  createPlaylist:
    vi.fn<(name: string, songIds: string[]) => Promise<PlaylistDetail>>(),
  deletePlaylist: vi.fn<(playlistId: string) => Promise<void>>(),
  fetchPlaylist: vi.fn<(playlistId: string) => Promise<PlaylistDetail>>(),
  fetchPlaylists: vi.fn<() => Promise<PlaylistSummary[]>>(),
  fetchRadioShow: vi.fn<(showId: number) => Promise<RadioShow>>(),
  invalidateCoverArt:
    vi.fn<(coverArtId: string) => Promise<CoverArtOrderingReceipt>>(),
  updatePlaylist:
    vi.fn<
      (input: PlaylistUpdateInput) => Promise<PlaylistDetail | undefined>
    >(),
};

let nextCoverOrderingSequence = 1n;

function takeCoverOrderingReceipt() {
  const sequence = nextCoverOrderingSequence;
  nextCoverOrderingSequence += 1n;
  return { sequence: sequence.toString() };
}

function isPlaylistUpdatePayload(
  value: OwnDataValue,
): value is OwnDataRecord {
  return value !== null && Object(value) === value && !Array.isArray(value);
}

function playlistUpdateInput(value: OwnDataValue): PlaylistUpdateInput {
  if (!isPlaylistUpdatePayload(value)) {
    throw new TypeError("Saved-library playlist update is invalid");
  }
  const input: PlaylistUpdateInput = {
    playlistId: tauriString(value.playlistId, "playlistId"),
  };
  const {
    name,
    comment,
    public: isPublic,
    songIdsToAdd,
    songIndexesToRemove,
  } = value;
  if (name !== undefined) input.name = tauriString(name, "name");
  if (comment !== undefined) input.comment = tauriString(comment, "comment");
  if (isPublic !== undefined) {
    input.public = tauriBoolean(isPublic, "public");
  }
  if (songIdsToAdd !== undefined) {
    input.songIdsToAdd = tauriStringList(songIdsToAdd, "songIdsToAdd");
  }
  if (songIndexesToRemove !== undefined) {
    input.songIndexesToRemove = tauriNumberList(
      songIndexesToRemove,
      "songIndexesToRemove",
    );
  }
  return input;
}

function installSavedLibraryBridge(): void {
  let nextCallbackId = 1;
  installTauriEventPluginTestInternals();
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {
      convertFileSrc: (path: string, protocol: string) => `${protocol}:${path}`,
      invoke: async (command: string, args?: InvokeArgs) => {
        const values = readTauriInvokeArguments(args);
        switch (command) {
          case "create_playlist":
            return mocks.createPlaylist(
              tauriString(values.name, "name"),
              tauriStringList(values.songIds, "songIds"),
            );
          case "delete_playlist":
            return mocks.deletePlaylist(
              tauriString(values.playlistId, "playlistId"),
            );
          case "fetch_playlist":
            return mocks.fetchPlaylist(
              tauriString(values.playlistId, "playlistId"),
            );
          case "fetch_playlists":
            return mocks.fetchPlaylists();
          case "invalidate_cover_art":
            return mocks.invalidateCoverArt(
              tauriString(values.coverArtId, "coverArtId"),
            );
          case "plugin:event|listen":
            return 1;
          case "plugin:event|unlisten":
            return undefined;
          case "radio_show":
            return mocks.fetchRadioShow(tauriNumber(values.showId, "showId"));
          case "update_playlist":
            return (
              (await mocks.updatePlaylist(playlistUpdateInput(values.input))) ??
              null
            );
          default:
            throw new Error(`Unexpected saved-library command: ${command}`);
        }
      },
      transformCallback: () => nextCallbackId++,
      unregisterCallback: () => undefined,
    },
  });
}

export const track: Track = {
  id: "song-1",
  title: "Mirage",
  artist: "Sweeps",
  album: "Mirage",
  albumId: "album-1",
  duration: 188,
  track: 1,
  palette: ["#a66", "#222"],
};

export const secondTrack: Track = {
  ...track,
  id: "song-2",
  title: "Lanterns",
  duration: 204,
  track: 2,
};

export const summary: PlaylistSummary = {
  id: "playlist-1",
  name: "Night drive",
  songCount: 1,
  duration: 188,
};

export const detail: PlaylistDetail = {
  ...summary,
  tracks: [track],
};

export type PlaylistIdentityTransitionSnapshot = {
  afterDetail?: string;
  afterReturn?: string;
  afterScrollTop?: number;
  afterTitleDetail?: string;
  afterTitleReturn?: string;
  afterTitleReturnIsStatic: boolean;
  beforeDetail?: string;
  beforeSource?: string;
  beforeTitleDetail?: string;
  beforeTitleSource?: string;
  beforeTitleSourceIsStatic: boolean;
  className: string;
  identityAndTitleAreSeparate?: boolean;
};

export type PlaylistReturnSnapshot = {
  afterIcon?: string;
  afterTitle?: string;
  beforeIcon?: string;
  beforeTitle?: string;
};

export const otherSummary: PlaylistSummary = {
  id: "playlist-2",
  name: "Sunday morning",
  songCount: 2,
  duration: 392,
};

export const favorites: LocalFavoriteCollection = {
  albumIds: ["album-1"],
  songIds: ["song-1"],
  albums: [
    {
      id: "album-1",
      title: "Mirage",
      artist: "Sweeps",
      songCount: 1,
      duration: 188,
      palette: ["#a66", "#222"],
    },
  ],
  tracks: [track],
  radioShowIds: [979],
  radioShows: [
    {
      id: 979,
      subtitle: "The Hip Hop Show",
      description: "New independent hip-hop.",
      artworkUrl: "https://bandcamp.com/radio-cover.jpg",
      publishedAt: "24 Jul 2026 00:00:00 GMT",
      series: {
        id: 5,
        title: "The Hip Hop Show",
        slug: "the-hip-hop-show",
      },
    },
  ],
};

type SavedLibraryRender = RenderResult & {
  queryClient: QueryClient;
  router: ReturnType<typeof createCodaMemoryRouter>;
};

type SavedLibraryRouteRender = SavedLibraryRender & {
  rerenderRuntime: (runtime: SavedLibraryRuntimeValue) => void;
};

const originalRootComponent = RootRoute.options.component;

function SavedLibraryTestRoot() {
  const router = useRouter();
  const LibrarySessionBoundary = router.options.context.librarySessionBoundary;
  return (
    <LibrarySessionBoundary>
      <Outlet />
    </LibrarySessionBoundary>
  );
}

export function withQueryClient(node: ReactNode): SavedLibraryRender {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const router = createCodaMemoryRouter(queryClient, ["/favorites"]);
  return {
    ...render(
      <CodaMotionProvider>
        <QueryClientProvider client={queryClient}>
          <RouterContextProvider router={router}>{node}</RouterContextProvider>
        </QueryClientProvider>
      </CodaMotionProvider>,
    ),
    queryClient,
    router,
  };
}

export function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

export function resizeObserverEntry(
  target: Element,
  bounds: DOMRectReadOnly,
): ResizeObserverEntry {
  const size: ResizeObserverSize = {
    blockSize: bounds.height,
    inlineSize: bounds.width,
  };
  return {
    borderBoxSize: [size],
    contentBoxSize: [size],
    contentRect: bounds,
    devicePixelContentBoxSize: [size],
    target,
  };
}

export function mockVirtualizedViewport({
  contentTop,
  height,
  isScrollElement,
  width,
}: {
  contentTop: number;
  height: number;
  isScrollElement: (element: HTMLElement) => boolean;
  width: number;
}) {
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  const originalResizeObserver = globalThis.ResizeObserver;
  class ResizeObserverMock implements ResizeObserver {
    private readonly observed = new WeakSet<Element>();
    constructor(private readonly callback: ResizeObserverCallback) {}
    disconnect() {}
    observe(target: Element) {
      if (this.observed.has(target)) return;
      this.observed.add(target);
      const bounds = target.getBoundingClientRect();
      this.callback([resizeObserverEntry(target, bounds)], this);
    }
    unobserve() {}
  }
  globalThis.ResizeObserver = ResizeObserverMock;
  HTMLElement.prototype.getBoundingClientRect =
    function getBoundingClientRect() {
      const scrollElement = isScrollElement(this);
      const top = scrollElement ? 0 : contentTop;
      const elementHeight = scrollElement ? height : 0;
      return {
        bottom: top + elementHeight,
        height: elementHeight,
        left: 0,
        right: width,
        top,
        width,
        x: 0,
        y: top,
        toJSON: () => undefined,
      };
    };
  return () => {
    HTMLElement.prototype.getBoundingClientRect = originalRect;
    globalThis.ResizeObserver = originalResizeObserver;
  };
}

export function AddDialogHarness({
  onNotify = vi.fn(),
}: {
  onNotify?: (message: string, tone?: "good" | "bad") => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Add selected to playlist
      </button>
      {open ? (
        <AddToPlaylistDialog
          tracks={[track]}
          onClose={() => setOpen(false)}
          onNotify={onNotify}
        />
      ) : null}
    </>
  );
}

const disabledUpdater: AppUpdaterController = {
  supported: false,
  promptVisible: false,
  checking: false,
  manualCheckState: "idle",
  installState: "idle",
  progress: 0,
  checkManually: async () => undefined,
  dismiss: () => undefined,
  install: async () => undefined,
  restart: async () => undefined,
};

const loadDisconnectedLastFmStatus = async () => ({
  configured: false,
  connected: false,
});

export function PersistentAddDialogHarness() {
  const controller = usePersistentOverlaysController({
    loadLastFmStatus: loadDisconnectedLastFmStatus,
  });
  const firstTriggerRef = useRef<HTMLButtonElement>(null);
  const secondTriggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        ref={firstTriggerRef}
        type="button"
        onClick={() => controller.commands.openAddToPlaylist([track])}
      >
        Add first selection
      </button>
      <button
        ref={secondTriggerRef}
        type="button"
        onClick={() => controller.commands.openAddToPlaylist([secondTrack])}
      >
        Add second selection
      </button>
      <PersistentAppOverlays
        connected
        controller={controller}
        notify={vi.fn()}
        onConnected={() => undefined}
        onDisconnected={async () => undefined}
        updater={disabledUpdater}
      />
    </>
  );
}

export const commonProps = {
  connected: true,
  favorites,
  favoritesLoading: false,
  favoritesLocal: true,
  onRefreshFavorites: vi.fn(),
  onToggleFavorite: vi.fn(),
  onToggleRadioFavorite: vi.fn(),
  playing: false,
  onTogglePlayback: vi.fn(),
  onPlayTracks: vi.fn(),
  onQueueTracks: vi.fn(),
  onPlayTrack: vi.fn(),
  onQueueTrack: vi.fn(),
  onOpenAlbum: vi.fn(),
  onOpenTrackAlbum: vi.fn(),
  onOpenArtist: vi.fn(),
  onOpenRadioShow: vi.fn(),
  onOpenRadioSeries: vi.fn(),
  onAddToPlaylist: vi.fn(),
  onNotify: vi.fn(),
} satisfies SavedLibraryRuntimeValue;

export function renderSavedLibraryRoute({
  initialEntry = "/favorites",
  runtime: initialRuntime = commonProps,
  seedQueryClient,
}: Readonly<{
  initialEntry?: string;
  runtime?: SavedLibraryRuntimeValue;
  seedQueryClient?: (queryClient: QueryClient) => void;
}> = {}): SavedLibraryRouteRender {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const librarySession = createLibrarySessionController({ queryClient });
  if (initialRuntime.connected) {
    librarySession.commands.acceptConnectedLibrary([], { announce: false });
  }
  seedQueryClient?.(queryClient);
  const router = createCodaMemoryRouter(
    queryClient,
    [initialEntry],
    librarySession,
  );
  RootRoute.update({ component: SavedLibraryTestRoot });
  const routeTree = (runtime: SavedLibraryRuntimeValue) => (
    <CodaMotionProvider>
      <QueryClientProvider client={queryClient}>
        <SavedLibraryRuntimeProvider value={runtime}>
          <div
            data-coda-library-scroll
            style={{ height: 600, overflowY: "auto" }}
          >
            <RouterProvider router={router} />
          </div>
        </SavedLibraryRuntimeProvider>
      </QueryClientProvider>
    </CodaMotionProvider>
  );
  const view = render(routeTree(initialRuntime));

  return {
    ...view,
    queryClient,
    rerenderRuntime: (runtime) => {
      view.rerender(routeTree(runtime));
    },
    router,
  };
}

beforeEach(() => {
  installSavedLibraryBridge();
  clearCoverArtRendererState();
  Object.values(mocks).forEach((mock) => {
    mock.mockReset();
  });
  mocks.fetchPlaylists.mockResolvedValue([summary]);
  mocks.fetchPlaylist.mockResolvedValue(detail);
  mocks.invalidateCoverArt.mockImplementation(() =>
    Promise.resolve(takeCoverOrderingReceipt()),
  );
  mocks.fetchRadioShow.mockResolvedValue({
    ...favorites.radioShows[0],
    chapters: [],
    duration: 3_600,
    streamUrl: "https://bandcamp.com/radio-stream",
    title: "Bandcamp Weekly",
  });
  mocks.createPlaylist.mockResolvedValue(detail);
  mocks.updatePlaylist.mockResolvedValue(detail);
  mocks.deletePlaylist.mockResolvedValue(undefined);
  Object.values(commonProps).forEach((value) => {
    if (vi.isMockFunction(value)) value.mockClear();
  });
});

afterEach(() => {
  resetDetailNavigation();
  RootRoute.update({ component: originalRootComponent });
});
