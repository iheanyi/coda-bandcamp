import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import { useRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CodaMotionProvider } from "./MotionProvider";
import type { AppUpdaterController } from "./appUpdaterController";
import {
  FavoritesScreen,
  PlaylistDetailScreen,
  PlaylistsScreen,
} from "@/features/saved-library";
import { PersistentAppOverlays } from "@/features/settings/PersistentAppOverlays";
import { usePersistentOverlaysController } from "@/features/settings/usePersistentOverlaysController";
import { createCodaMemoryRouter } from "@/router";
import { parsePlaylistIdParam } from "@/routing/routeContracts";
import type {
  LocalFavoriteCollection,
  PlaylistDetail,
  PlaylistSummary,
  Track,
} from "./types";

const mocks = vi.hoisted(() => ({
  coverArtRevisions: new Map<string, string>(),
  createPlaylist: vi.fn(),
  deletePlaylist: vi.fn(),
  fetchPlaylist: vi.fn(),
  fetchPlaylists: vi.fn(),
  fetchRadioShow: vi.fn(),
  invalidateCoverArt: vi.fn<(coverArtId: string) => Promise<void>>(),
  updatePlaylist: vi.fn(),
}));

vi.mock("@/coverArtSource", () => ({
  clearCoverArtRendererState: () => mocks.coverArtRevisions.clear(),
  coverArtSource: (coverArtId: string) =>
    `coda-cover:/v1/600/${encodeURIComponent(coverArtId)}?v=${mocks.coverArtRevisions.get(coverArtId) ?? "0"}&s=0123456789abcdef0123456789abcdef`,
  invalidateCoverArt: mocks.invalidateCoverArt,
  useCoverArtSource: (coverArtId: string | undefined) =>
    coverArtId
      ? `coda-cover:/v1/600/${encodeURIComponent(coverArtId)}?v=${mocks.coverArtRevisions.get(coverArtId) ?? "0"}&s=0123456789abcdef0123456789abcdef`
      : undefined,
}));

vi.mock("./lib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib")>();
  return {
    ...actual,
    createPlaylist: mocks.createPlaylist,
    deletePlaylist: mocks.deletePlaylist,
    fetchPlaylist: mocks.fetchPlaylist,
    fetchPlaylists: mocks.fetchPlaylists,
    fetchRadioShow: mocks.fetchRadioShow,
    updatePlaylist: mocks.updatePlaylist,
  };
});

import SavedLibraryView, { AddToPlaylistDialog } from "./SavedLibraryView";

const track: Track = {
  id: "song-1",
  title: "Mirage",
  artist: "Sweeps",
  album: "Mirage",
  albumId: "album-1",
  duration: 188,
  track: 1,
  palette: ["#a66", "#222"],
};

const secondTrack: Track = {
  ...track,
  id: "song-2",
  title: "Lanterns",
  duration: 204,
  track: 2,
};

const summary: PlaylistSummary = {
  id: "playlist-1",
  name: "Night drive",
  songCount: 1,
  duration: 188,
};

const detail: PlaylistDetail = {
  ...summary,
  tracks: [track],
};

const otherSummary: PlaylistSummary = {
  id: "playlist-2",
  name: "Sunday morning",
  songCount: 2,
  duration: 392,
};

const favorites: LocalFavoriteCollection = {
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

function withQueryClient(node: React.ReactNode) {
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

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function mockVirtualizedViewport({
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
      this.callback(
        [
          {
            borderBoxSize: [
              {
                blockSize: bounds.height,
                inlineSize: bounds.width,
              },
            ],
            contentRect: bounds,
            target,
          } as unknown as ResizeObserverEntry,
        ],
        this,
      );
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

function AddDialogHarness({
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

function PersistentAddDialogHarness() {
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

const commonProps = {
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
};

beforeEach(() => {
  Object.values(mocks).forEach((mock) => {
    if (typeof mock === "function" && "mockReset" in mock) mock.mockReset();
  });
  mocks.fetchPlaylists.mockResolvedValue([summary]);
  mocks.fetchPlaylist.mockResolvedValue(detail);
  mocks.coverArtRevisions.clear();
  mocks.invalidateCoverArt.mockReset().mockImplementation((coverArtId) => {
    mocks.coverArtRevisions.set(coverArtId, "retry");
    return Promise.resolve();
  });
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
    if (typeof value === "function" && "mockClear" in value) value.mockClear();
  });
});

describe("saved Bandcamp library views", () => {
  it("renders Favorites through its explicit route screen", () => {
    const { connected: _connected, ...favoriteProps } = commonProps;
    withQueryClient(
      <FavoritesScreen className="favorites-route" {...favoriteProps} />,
    );

    expect(
      screen.getByRole("heading", { name: "Favorites" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Favorites" }).closest("section"),
    ).toHaveClass("favorites-route");
    expect(mocks.fetchPlaylists).not.toHaveBeenCalled();
  });

  it("distinguishes synced music stars from device-local Radio favorites", () => {
    withQueryClient(
      <SavedLibraryView
        mode="favorites"
        {...commonProps}
        favoritesLocal={false}
      />,
    );

    expect(
      screen.getByText(
        "Music favorites sync through Bandcamp’s Subsonic service, separate from the Bandcamp website. Track listings can lag, so Coda confirms them as albums load and on Refresh. Radio shows stay on this device.",
      ),
    ).toBeInTheDocument();
  });

  it("emits validated playlist identity from the route list screen", async () => {
    const onOpenPlaylist = vi.fn();
    withQueryClient(
      <PlaylistsScreen
        connected
        onOpenPlaylist={onOpenPlaylist}
        onNotify={commonProps.onNotify}
      />,
    );

    fireEvent.click(await screen.findByRole("link", { name: /Night drive/ }));
    expect(onOpenPlaylist).toHaveBeenCalledWith(
      parsePlaylistIdParam("playlist-1"),
    );
  });

  it("loads a direct playlist detail by controlled ID without waiting for the list", async () => {
    mocks.fetchPlaylists.mockReturnValueOnce(new Promise(() => undefined));
    const onBack = vi.fn();
    withQueryClient(
      <PlaylistDetailScreen
        className="playlist-detail-route"
        connected
        playlistId={parsePlaylistIdParam("playlist-1")}
        playing={false}
        onBack={onBack}
        onTogglePlayback={commonProps.onTogglePlayback}
        onPlayTracks={commonProps.onPlayTracks}
        onQueueTracks={commonProps.onQueueTracks}
        onOpenTrackAlbum={commonProps.onOpenTrackAlbum}
        onOpenArtist={commonProps.onOpenArtist}
        onAddToPlaylist={commonProps.onAddToPlaylist}
        onNotify={commonProps.onNotify}
      />,
    );

    const heading = await screen.findByRole("heading", { name: "Night drive" });
    expect(heading).toHaveFocus();
    expect(heading.closest("section")).toHaveClass("playlist-detail-route");
    expect(mocks.fetchPlaylist).toHaveBeenCalledWith("playlist-1");
    expect(mocks.fetchPlaylists).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("opens a cold playlist directly into its live loading state", async () => {
    const playlistRequest = deferred<PlaylistDetail>();
    mocks.fetchPlaylist.mockReturnValueOnce(playlistRequest.promise);
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "startViewTransition",
    );
    const startViewTransition = vi.fn();
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    try {
      withQueryClient(<SavedLibraryView mode="playlists" {...commonProps} />);

      const playlistButton = await screen.findByRole("link", {
        name: /Night drive/,
      });
      fireEvent.click(playlistButton);

      expect(document.documentElement).toHaveClass(
        "coda-transition--page-forward",
      );
      expect(startViewTransition).not.toHaveBeenCalled();
      const loadingHeading = screen.getByText("Loading playlist");
      const loadingSurface = loadingHeading.parentElement;
      expect(
        loadingSurface?.querySelectorAll('[data-slot="spinner"]'),
      ).toHaveLength(1);
      expect(
        loadingSurface?.querySelector('[data-slot="skeleton"]'),
      ).not.toBeInTheDocument();
    } finally {
      await act(async () => {
        playlistRequest.resolve(detail);
        await Promise.resolve();
      });
      if (originalDescriptor) {
        Object.defineProperty(
          document,
          "startViewTransition",
          originalDescriptor,
        );
      } else {
        Reflect.deleteProperty(document, "startViewTransition");
      }
    }
  });

  it("uses a directional Back transition after a cold playlist finishes opening", async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "startViewTransition",
    );
    const startViewTransition = vi.fn();
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    try {
      withQueryClient(<SavedLibraryView mode="playlists" {...commonProps} />);

      fireEvent.click(
        await screen.findByRole("link", {
          name: /Night drive/,
        }),
      );
      expect(
        await screen.findByRole("heading", { name: "Night drive" }),
      ).toBeInTheDocument();
      expect(startViewTransition).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Back" }));
      expect(document.documentElement).toHaveClass(
        "coda-transition--page-back",
      );

      expect(
        await screen.findByRole("link", { name: /Night drive/ }),
      ).toBeInTheDocument();
      expect(startViewTransition).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(document.documentElement).not.toHaveClass(
          "coda-transition--page-back",
        ),
      );
      expect(
        document.querySelector("[data-coda-playlist-identity-return]"),
      ).not.toBeInTheDocument();
    } finally {
      vi.unstubAllEnvs();
      if (originalDescriptor) {
        Object.defineProperty(
          document,
          "startViewTransition",
          originalDescriptor,
        );
      } else {
        Reflect.deleteProperty(document, "startViewTransition");
      }
    }
  });

  it("pairs a warm playlist identity with its detail and returning row", async () => {
    mocks.fetchPlaylists.mockResolvedValueOnce([summary, otherSummary]);
    const snapshots: Array<{
      className: string;
      beforeDetail?: string;
      beforeSource?: string;
      beforeTitleDetail?: string;
      beforeTitleSource?: string;
      afterDetail?: string;
      afterReturn?: string;
      afterTitleDetail?: string;
      afterTitleReturn?: string;
      afterFocusedPlaylist?: string;
      afterScrollTop?: number;
      identityAndTitleAreSeparate?: boolean;
    }> = [];
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "startViewTransition",
    );
    const startViewTransition = vi.fn((update: () => void) => {
      const snapshot = {
        className: document.documentElement.className,
        beforeDetail: document.querySelector<HTMLElement>(
          "[data-coda-playlist-identity-detail]",
        )?.dataset.codaPlaylistIdentityDetail,
        beforeSource: document.querySelector<HTMLElement>(
          "[data-coda-playlist-identity-source]",
        )?.dataset.codaPlaylistIdentitySource,
        beforeTitleDetail: document.querySelector<HTMLElement>(
          "[data-coda-playlist-title-detail]",
        )?.dataset.codaPlaylistTitleDetail,
        beforeTitleSource: document.querySelector<HTMLElement>(
          "[data-coda-playlist-title-source]",
        )?.dataset.codaPlaylistTitleSource,
        beforeTitleSourceIsStatic:
          document
            .querySelector("[data-coda-playlist-title-source]")
            ?.matches('[data-slot="overflow-marquee-text"]') ?? false,
        afterDetail: undefined as string | undefined,
        afterReturn: undefined as string | undefined,
        afterTitleDetail: undefined as string | undefined,
        afterTitleReturn: undefined as string | undefined,
        afterTitleReturnIsStatic: false,
        afterFocusedPlaylist: undefined as string | undefined,
        afterScrollTop: undefined as number | undefined,
        identityAndTitleAreSeparate: undefined as boolean | undefined,
      };
      expect(
        document.querySelectorAll("[data-coda-playlist-identity-source]"),
      ).toHaveLength(snapshot.beforeSource ? 1 : 0);
      expect(
        document.querySelectorAll("[data-coda-playlist-title-source]"),
      ).toHaveLength(snapshot.beforeTitleSource ? 1 : 0);
      update();
      snapshot.afterDetail = document.querySelector<HTMLElement>(
        "[data-coda-playlist-identity-detail]",
      )?.dataset.codaPlaylistIdentityDetail;
      snapshot.afterReturn = document.querySelector<HTMLElement>(
        "[data-coda-playlist-identity-return]",
      )?.dataset.codaPlaylistIdentityReturn;
      snapshot.afterTitleDetail = document.querySelector<HTMLElement>(
        "[data-coda-playlist-title-detail]",
      )?.dataset.codaPlaylistTitleDetail;
      snapshot.afterTitleReturn = document.querySelector<HTMLElement>(
        "[data-coda-playlist-title-return]",
      )?.dataset.codaPlaylistTitleReturn;
      snapshot.afterTitleReturnIsStatic =
        document
          .querySelector("[data-coda-playlist-title-return]")
          ?.matches('[data-slot="overflow-marquee-text"]') ?? false;
      const identityTarget = document.querySelector<HTMLElement>(
        "[data-coda-playlist-identity-detail], [data-coda-playlist-identity-return]",
      );
      const titleTarget = document.querySelector<HTMLElement>(
        "[data-coda-playlist-title-detail], [data-coda-playlist-title-return]",
      );
      snapshot.identityAndTitleAreSeparate =
        Boolean(identityTarget) &&
        Boolean(titleTarget) &&
        identityTarget !== titleTarget;
      expect(
        document.querySelectorAll("[data-coda-playlist-identity-return]"),
      ).toHaveLength(snapshot.afterReturn ? 1 : 0);
      expect(
        document.querySelectorAll("[data-coda-playlist-title-return]"),
      ).toHaveLength(snapshot.afterTitleReturn ? 1 : 0);
      snapshot.afterFocusedPlaylist =
        document.activeElement instanceof HTMLElement
          ? document.activeElement.dataset.playlistOpen
          : undefined;
      snapshot.afterScrollTop = document.querySelector<HTMLElement>(
        "[data-coda-library-scroll]",
      )?.scrollTop;
      snapshots.push(snapshot);
      return { finished: Promise.resolve() };
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    try {
      const { queryClient } = withQueryClient(
        <div data-coda-library-scroll>
          <SavedLibraryView mode="playlists" {...commonProps} />
        </div>,
      );
      await screen.findByRole("link", { name: /Night drive/ });
      const scrollRoot = document.querySelector<HTMLElement>(
        "[data-coda-library-scroll]",
      );
      expect(scrollRoot).toBeInTheDocument();
      scrollRoot!.scrollTop = 173;
      queryClient.setQueryData(["bandcamp", "playlists", summary.id], detail);

      fireEvent.click(screen.getByRole("link", { name: /Night drive/ }));

      expect(startViewTransition).toHaveBeenCalledOnce();
      expect(
        screen.getByRole("heading", { name: "Night drive" }),
      ).toBeInTheDocument();
      expect(
        document.querySelector("[data-coda-playlist-detail-surface]"),
      ).not.toContainElement(screen.getByRole("button", { name: "Back" }));

      fireEvent.click(screen.getByRole("button", { name: "Back" }));

      expect(startViewTransition).toHaveBeenCalledTimes(2);
      expect(snapshots).toEqual([
        {
          className: expect.stringContaining(
            "coda-transition--playlist-detail",
          ),
          beforeDetail: undefined,
          beforeSource: summary.id,
          beforeTitleDetail: undefined,
          beforeTitleSource: summary.id,
          beforeTitleSourceIsStatic: true,
          afterDetail: summary.id,
          afterReturn: undefined,
          afterTitleDetail: summary.id,
          afterTitleReturn: undefined,
          afterTitleReturnIsStatic: false,
          afterFocusedPlaylist: undefined,
          afterScrollTop: 0,
          identityAndTitleAreSeparate: true,
        },
        {
          className: expect.stringContaining(
            "coda-transition--playlist-detail-close",
          ),
          beforeDetail: summary.id,
          beforeSource: undefined,
          beforeTitleDetail: summary.id,
          beforeTitleSource: undefined,
          beforeTitleSourceIsStatic: false,
          afterDetail: undefined,
          afterReturn: summary.id,
          afterTitleDetail: undefined,
          afterTitleReturn: summary.id,
          afterTitleReturnIsStatic: true,
          afterFocusedPlaylist: summary.id,
          afterScrollTop: 173,
          identityAndTitleAreSeparate: true,
        },
      ]);
      await waitFor(() =>
        expect(
          document.querySelectorAll(
            "[data-coda-playlist-identity-return], [data-coda-playlist-title-return]",
          ),
        ).toHaveLength(0),
      );
    } finally {
      vi.unstubAllEnvs();
      document.documentElement.classList.remove(
        "coda-transition--playlist-detail",
        "coda-transition--playlist-detail-close",
      );
      if (originalDescriptor) {
        Object.defineProperty(
          document,
          "startViewTransition",
          originalDescriptor,
        );
      } else {
        Reflect.deleteProperty(document, "startViewTransition");
      }
    }
  });

  it("keeps the icon pair when Back starts while the playlist name is being edited", async () => {
    const returnSnapshot: {
      beforeIcon?: string;
      beforeTitle?: string;
      afterIcon?: string;
      afterTitle?: string;
    } = {};
    let transitionCount = 0;
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "startViewTransition",
    );
    const startViewTransition = vi.fn((update: () => void) => {
      transitionCount += 1;
      if (transitionCount === 2) {
        returnSnapshot.beforeIcon = document.querySelector<HTMLElement>(
          "[data-coda-playlist-identity-detail]",
        )?.dataset.codaPlaylistIdentityDetail;
        returnSnapshot.beforeTitle = document.querySelector<HTMLElement>(
          "[data-coda-playlist-title-detail]",
        )?.dataset.codaPlaylistTitleDetail;
      }
      update();
      if (transitionCount === 2) {
        returnSnapshot.afterIcon = document.querySelector<HTMLElement>(
          "[data-coda-playlist-identity-return]",
        )?.dataset.codaPlaylistIdentityReturn;
        returnSnapshot.afterTitle = document.querySelector<HTMLElement>(
          "[data-coda-playlist-title-return]",
        )?.dataset.codaPlaylistTitleReturn;
      }
      return { finished: Promise.resolve() };
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    try {
      const { queryClient } = withQueryClient(
        <SavedLibraryView mode="playlists" {...commonProps} />,
      );
      await screen.findByRole("link", { name: /Night drive/ });
      queryClient.setQueryData(["bandcamp", "playlists", summary.id], detail);

      fireEvent.click(screen.getByRole("link", { name: /Night drive/ }));
      fireEvent.click(
        await screen.findByRole("button", {
          name: `Rename ${summary.name}`,
        }),
      );
      expect(
        screen.getByRole("textbox", { name: "Playlist name" }),
      ).toBeInTheDocument();
      expect(
        document.querySelector("[data-coda-playlist-title-detail]"),
      ).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Back" }));

      expect(returnSnapshot).toEqual({
        beforeIcon: summary.id,
        beforeTitle: undefined,
        afterIcon: summary.id,
        afterTitle: summary.id,
      });
      await waitFor(() =>
        expect(
          document.querySelectorAll(
            "[data-coda-playlist-identity-return], [data-coda-playlist-title-return]",
          ),
        ).toHaveLength(0),
      );
    } finally {
      vi.unstubAllEnvs();
      document.documentElement.classList.remove(
        "coda-transition--playlist-detail",
        "coda-transition--playlist-detail-close",
      );
      if (originalDescriptor) {
        Object.defineProperty(
          document,
          "startViewTransition",
          originalDescriptor,
        );
      } else {
        Reflect.deleteProperty(document, "startViewTransition");
      }
    }
  });

  it("opens a synced playlist and exposes playback and editing actions", async () => {
    withQueryClient(<SavedLibraryView mode="playlists" {...commonProps} />);

    expect(await screen.findByText("Create a playlist")).toBeInTheDocument();
    expect(screen.getByText("New playlist")).toBeInTheDocument();
    expect(
      screen.getByText("Playlists sync with your Bandcamp collection."),
    ).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("link", { name: /Night drive/ }));
    const playlistHeading = await screen.findByRole("heading", {
      name: "Night drive",
    });
    expect(playlistHeading).toBeInTheDocument();
    expect(
      document.querySelector("[data-coda-playlist-metadata-detail]"),
    ).toHaveAttribute("data-coda-playlist-metadata-detail", summary.id);
    expect(within(playlistHeading).getByText(summary.name)).toHaveAttribute(
      "data-coda-playlist-title-detail",
      summary.id,
    );
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(commonProps.onPlayTracks).toHaveBeenCalledWith([track]);
    const playlistTracks = screen.getByLabelText("Night drive tracks");
    expect(within(playlistTracks).getByRole("listitem")).toHaveClass(
      "h-16",
      "py-3",
      "after:absolute",
      "grid-cols-[2rem_2.5rem_minmax(0,1fr)_3rem_repeat(2,2rem)]",
      "lg:grid-cols-[2rem_2.5rem_minmax(0,1fr)_4rem_repeat(2,2rem)]",
    );
    expect(within(playlistTracks).getByRole("listitem")).not.toHaveClass(
      "border-b",
    );
    expect(within(playlistTracks).getByRole("listitem")).not.toHaveClass(
      "h-14",
    );
    const playlistArtistLink = within(playlistTracks).getByRole("link", {
      name: "Sweeps",
    });
    expect(playlistArtistLink).toHaveAttribute(
      "href",
      "/collection/artists/sweeps?q=&genre=All&sort=recent&mode=artists&albumId=album-1",
    );
    fireEvent.click(playlistArtistLink);
    expect(commonProps.onOpenArtist).toHaveBeenCalledWith(
      "Sweeps",
      "album-1",
      track,
      expect.any(HTMLElement),
    );
    const playlistAlbumButton = within(playlistTracks)
      .getAllByRole("link", { name: "Open Mirage album" })
      .find(
        (link) =>
          link.getAttribute("data-navigation-slot") === "playlist-track:song-1",
      );
    if (!playlistAlbumButton) throw new Error("Expected playlist album link");
    expect(playlistAlbumButton).toHaveAttribute(
      "href",
      "/collection/albums/album-1?q=&genre=All&sort=recent&mode=releases",
    );
    fireEvent.click(playlistAlbumButton);
    expect(commonProps.onOpenTrackAlbum).toHaveBeenCalledWith(
      track,
      playlistAlbumButton,
    );

    fireEvent.click(screen.getByRole("button", { name: "Rename Night drive" }));
    fireEvent.change(screen.getByLabelText("Playlist name"), {
      target: { value: "After hours" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save playlist name" }));
    await waitFor(() =>
      expect(mocks.updatePlaylist.mock.calls[0]?.[0]).toEqual({
        playlistId: "playlist-1",
        name: "After hours",
      }),
    );
  });

  it("uses the first track artwork when Bandcamp omits a playlist cover", async () => {
    mocks.fetchPlaylist.mockResolvedValueOnce({
      ...detail,
      tracks: [{ ...track, coverArt: "first-track-cover" }],
    });
    const { container } = withQueryClient(
      <SavedLibraryView mode="playlists" {...commonProps} />,
    );

    fireEvent.click(await screen.findByRole("link", { name: /Night drive/ }));

    await waitFor(() =>
      expect(container.querySelector("header img")).toHaveAttribute(
        "src",
        "coda-cover:/v1/600/first-track-cover?v=0&s=0123456789abcdef0123456789abcdef",
      ),
    );
  });

  it("keeps replaced playlist artwork pending over its base color until load", async () => {
    mocks.fetchPlaylist.mockResolvedValueOnce({
      ...detail,
      tracks: [{ ...track, coverArt: "first-track-cover" }],
    });
    const { container, queryClient } = withQueryClient(
      <SavedLibraryView mode="playlists" {...commonProps} />,
    );

    fireEvent.click(await screen.findByRole("link", { name: /Night drive/ }));
    await waitFor(() =>
      expect(container.querySelector("header img")).toHaveAttribute(
        "src",
        "coda-cover:/v1/600/first-track-cover?v=0&s=0123456789abcdef0123456789abcdef",
      ),
    );

    act(() => {
      queryClient.setQueryData(["bandcamp", "playlists", "playlist-1"], {
        ...detail,
        tracks: [{ ...track, id: "song-2", coverArt: "next-track-cover" }],
      });
    });
    const nextImage = await waitFor(() => {
      const image = container.querySelector<HTMLImageElement>("header img");
      if (!image) throw new Error("Expected replacement playlist artwork");
      expect(image).toHaveAttribute(
        "src",
        "coda-cover:/v1/600/next-track-cover?v=0&s=0123456789abcdef0123456789abcdef",
      );
      expect(image).not.toHaveClass("invisible");
      expect(image).toHaveAttribute("data-cover-art-pending");
      expect(
        container.querySelector("header [data-favorite-artwork-fallback]"),
      ).not.toBeInTheDocument();
      return image;
    });

    fireEvent.load(nextImage);
    expect(nextImage).not.toHaveAttribute("data-cover-art-pending");
    expect(nextImage).toHaveAttribute("data-cover-art-reveal");
  });

  it("invalidates and retries a broken playlist cover once", async () => {
    mocks.fetchPlaylist.mockResolvedValueOnce({
      ...detail,
      tracks: [{ ...track, coverArt: "first-track-cover" }],
    });
    const { container } = withQueryClient(
      <SavedLibraryView mode="playlists" {...commonProps} />,
    );

    fireEvent.click(await screen.findByRole("link", { name: /Night drive/ }));
    const expired = await waitFor(() => {
      const image = container.querySelector<HTMLImageElement>("header img");
      if (!image) throw new Error("Expected playlist artwork");
      expect(image).toHaveAttribute(
        "src",
        "coda-cover:/v1/600/first-track-cover?v=0&s=0123456789abcdef0123456789abcdef",
      );
      return image;
    });
    fireEvent.error(expired);

    await waitFor(() =>
      expect(mocks.invalidateCoverArt).toHaveBeenCalledWith(
        "first-track-cover",
      ),
    );
    const retried = await waitFor(() => {
      const image = container.querySelector<HTMLImageElement>("header img");
      if (!image) throw new Error("Expected retried playlist artwork");
      expect(image).toHaveAttribute(
        "src",
        "coda-cover:/v1/600/first-track-cover?v=retry&s=0123456789abcdef0123456789abcdef",
      );
      return image;
    });
    fireEvent.error(retried);
    expect(container.querySelector("header img")).not.toBeInTheDocument();
    expect(mocks.invalidateCoverArt).toHaveBeenCalledOnce();
  });

  it("moves focus into playlist details and restores the opening row on Back", async () => {
    withQueryClient(<SavedLibraryView mode="playlists" {...commonProps} />);

    const playlistButton = await screen.findByRole("link", {
      name: /Night drive/,
    });
    playlistButton.focus();
    fireEvent.click(playlistButton);

    const heading = await screen.findByRole("heading", {
      name: "Night drive",
    });
    await waitFor(() => expect(heading).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    const restoredPlaylistButton = await screen.findByRole("link", {
      name: /Night drive/,
    });
    await waitFor(() => expect(restoredPlaylistButton).toHaveFocus());
  });

  it("creates a playlist with selected tracks from the add dialog", async () => {
    const onClose = vi.fn();
    const onNotify = vi.fn();
    withQueryClient(
      <AddToPlaylistDialog
        tracks={[track]}
        onClose={onClose}
        onNotify={onNotify}
      />,
    );

    fireEvent.change(screen.getByLabelText("New playlist name"), {
      target: { value: "Fresh finds" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(mocks.createPlaylist).toHaveBeenCalledWith("Fresh finds", [
        "song-1",
      ]),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("focuses the add form and restores its opener after idle dismissal", async () => {
    const user = userEvent.setup();
    withQueryClient(<AddDialogHarness />);

    const trigger = screen.getByRole("button", {
      name: "Add selected to playlist",
    });
    await user.click(trigger);
    await waitFor(() =>
      expect(screen.getByLabelText("New playlist name")).toHaveFocus(),
    );

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Add to playlist" }),
      ).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    fireEvent.pointerDown(document.body);
    fireEvent.mouseDown(document.body);
    fireEvent.click(document.body);
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Add to playlist" }),
      ).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });

  it("gives a rapidly reopened add dialog fresh state and the latest focus owner", async () => {
    const user = userEvent.setup();
    withQueryClient(<PersistentAddDialogHarness />);

    const firstTrigger = screen.getByRole("button", {
      name: "Add first selection",
    });
    const secondTrigger = screen.getByRole("button", {
      name: "Add second selection",
    });
    await user.click(firstTrigger);

    const firstNameInput = await screen.findByLabelText("New playlist name");
    await user.type(firstNameInput, "Stale draft");
    expect(firstNameInput).toHaveValue("Stale draft");

    await user.keyboard("{Escape}");
    expect(
      document.querySelector('[data-slot="dialog-content"]'),
    ).toBeInTheDocument();

    secondTrigger.focus();
    fireEvent.click(secondTrigger);

    const secondNameInput = await screen.findByLabelText("New playlist name");
    expect(secondNameInput).not.toBe(firstNameInput);
    expect(secondNameInput).toHaveValue("");
    await waitFor(() => expect(secondNameInput).toHaveFocus());

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    });
    expect(secondNameInput).toHaveFocus();
    expect(firstTrigger).not.toHaveFocus();

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Add to playlist" }),
      ).not.toBeInTheDocument(),
    );
    expect(secondTrigger).toHaveFocus();
    expect(firstTrigger).not.toHaveFocus();
  });

  it("rejects Escape and backdrop dismissal while an add mutation is pending", async () => {
    const user = userEvent.setup();
    const pendingCreate = deferred<PlaylistDetail>();
    mocks.createPlaylist.mockReturnValue(pendingCreate.promise);
    withQueryClient(<AddDialogHarness />);

    await user.click(
      screen.getByRole("button", {
        name: "Add selected to playlist",
      }),
    );
    await user.type(screen.getByLabelText("New playlist name"), "Fresh finds");
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(
      await screen.findByRole("button", { name: "Creating…" }),
    ).toBeDisabled();

    await user.keyboard("{Escape}");
    expect(
      screen.getByRole("dialog", { name: "Add to playlist" }),
    ).toBeVisible();
    fireEvent.pointerDown(document.body);
    fireEvent.mouseDown(document.body);
    fireEvent.click(document.body);
    expect(
      screen.getByRole("dialog", { name: "Add to playlist" }),
    ).toBeVisible();
    expect(mocks.createPlaylist).toHaveBeenCalledTimes(1);

    pendingCreate.resolve(detail);
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Add to playlist" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("shows a newly created playlist immediately and removes it on failure", async () => {
    const pendingCreate = deferred<PlaylistDetail>();
    mocks.createPlaylist.mockReturnValue(pendingCreate.promise);
    withQueryClient(<SavedLibraryView mode="playlists" {...commonProps} />);

    await screen.findByText("Create a playlist");
    fireEvent.change(screen.getByPlaceholderText("Late-night rotation"), {
      target: { value: "Fresh finds" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(
      await screen.findByRole("link", { name: /Fresh finds/ }),
    ).toBeInTheDocument();
    pendingCreate.reject(new Error("Create failed"));

    await waitFor(() =>
      expect(
        screen.queryByRole("link", { name: /Fresh finds/ }),
      ).not.toBeInTheDocument(),
    );
    expect(commonProps.onNotify).toHaveBeenCalledWith("Create failed", "bad");
  });

  it("optimistically renames a playlist and restores its name on failure", async () => {
    const pendingUpdate = deferred<PlaylistDetail>();
    mocks.updatePlaylist.mockReturnValue(pendingUpdate.promise);
    withQueryClient(<SavedLibraryView mode="playlists" {...commonProps} />);

    fireEvent.click(await screen.findByRole("link", { name: /Night drive/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Rename Night drive" }),
    );
    fireEvent.change(screen.getByLabelText("Playlist name"), {
      target: { value: "After hours" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save playlist name" }));

    expect(
      await screen.findByRole("heading", { name: "After hours" }),
    ).toBeInTheDocument();
    pendingUpdate.reject(new Error("Rename failed"));

    expect(
      await screen.findByRole("heading", { name: "Night drive" }),
    ).toBeInTheDocument();
    expect(commonProps.onNotify).toHaveBeenCalledWith("Rename failed", "bad");
  });

  it("optimistically removes a playlist track and rolls it back on failure", async () => {
    const twoTrackDetail: PlaylistDetail = {
      ...detail,
      duration: track.duration + secondTrack.duration,
      songCount: 2,
      tracks: [track, secondTrack],
    };
    const pendingUpdate = deferred<PlaylistDetail>();
    mocks.fetchPlaylist.mockResolvedValue(twoTrackDetail);
    mocks.updatePlaylist.mockReturnValue(pendingUpdate.promise);
    withQueryClient(<SavedLibraryView mode="playlists" {...commonProps} />);

    fireEvent.click(await screen.findByRole("link", { name: /Night drive/ }));
    const remove = await screen.findByRole("button", {
      name: "Remove Lanterns from Night drive",
    });
    fireEvent.click(remove);
    await waitFor(() =>
      expect(screen.queryByText("Lanterns")).not.toBeInTheDocument(),
    );

    pendingUpdate.reject(new Error("Remove failed"));
    expect(await screen.findByText("Lanterns")).toBeInTheDocument();
    expect(commonProps.onNotify).toHaveBeenCalledWith("Remove failed", "bad");
  });

  it("keeps a committed optimistic removal when playlist revalidation fails", async () => {
    const twoTrackDetail: PlaylistDetail = {
      ...detail,
      duration: track.duration + secondTrack.duration,
      songCount: 2,
      tracks: [track, secondTrack],
    };
    mocks.fetchPlaylist
      .mockResolvedValueOnce(twoTrackDetail)
      .mockRejectedValueOnce(new Error("Refresh failed"));
    mocks.updatePlaylist.mockResolvedValueOnce(undefined);
    withQueryClient(<SavedLibraryView mode="playlists" {...commonProps} />);

    fireEvent.click(await screen.findByRole("link", { name: /Night drive/ }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Remove Lanterns from Night drive",
      }),
    );

    await waitFor(() =>
      expect(screen.queryByText("Lanterns")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(mocks.fetchPlaylist).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Lanterns")).not.toBeInTheDocument();
    expect(commonProps.onNotify).not.toHaveBeenCalledWith(
      "Refresh failed",
      "bad",
    );
  });

  it("keeps deletion confirmation open while pending and retryable after failure", async () => {
    const user = userEvent.setup();
    const pendingDelete = deferred<void>();
    mocks.deletePlaylist.mockReturnValue(pendingDelete.promise);
    const { queryClient } = withQueryClient(
      <SavedLibraryView mode="playlists" {...commonProps} />,
    );

    await user.click(await screen.findByRole("link", { name: /Night drive/ }));
    const deleteTrigger = await screen.findByRole("button", {
      name: "Delete playlist",
    });
    await user.click(deleteTrigger);
    const deleteDialog = screen.getByRole("alertdialog", {
      name: "Delete Night drive?",
    });
    await waitFor(() => expect(deleteDialog).toBeVisible());

    await user.keyboard("{Escape}");
    expect(deleteDialog).toBeVisible();
    expect(mocks.deletePlaylist).not.toHaveBeenCalled();

    fireEvent.pointerDown(document.body);
    fireEvent.mouseDown(document.body);
    fireEvent.click(document.body);
    expect(deleteDialog).toBeVisible();
    expect(mocks.deletePlaylist).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Keep playlist" }));
    expect(mocks.deletePlaylist).not.toHaveBeenCalled();
    await waitFor(() => expect(deleteTrigger).toHaveFocus());

    await user.click(deleteTrigger);
    await user.click(
      screen.getByRole("button", {
        name: "Delete playlist from Bandcamp",
      }),
    );
    expect(mocks.deletePlaylist).toHaveBeenCalledTimes(1);
    expect(mocks.deletePlaylist.mock.calls[0]?.[0]).toBe("playlist-1");

    await waitFor(() =>
      expect(
        queryClient.getQueryData<PlaylistSummary[]>(["bandcamp", "playlists"]),
      ).toEqual([]),
    );
    expect(
      screen.getByRole("alertdialog", {
        name: "Delete Night drive?",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "Delete playlist from Bandcamp",
      }),
    ).toBeDisabled();
    expect(screen.getByText("Deleting…")).toBeInTheDocument();
    pendingDelete.reject(new Error("Delete failed"));

    await waitFor(() =>
      expect(
        queryClient.getQueryData<PlaylistSummary[]>(["bandcamp", "playlists"]),
      ).toEqual([summary]),
    );
    expect(
      screen.getByRole("alertdialog", {
        name: "Delete Night drive?",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "Delete playlist from Bandcamp",
      }),
    ).toBeEnabled();
    expect(commonProps.onNotify).toHaveBeenCalledWith("Delete failed", "bad");
  });

  it("optimistically updates Add-to-playlist counts and rolls back on failure", async () => {
    const pendingUpdate = deferred<PlaylistDetail>();
    mocks.updatePlaylist.mockReturnValue(pendingUpdate.promise);
    const onClose = vi.fn();
    const onNotify = vi.fn();
    withQueryClient(
      <AddToPlaylistDialog
        tracks={[secondTrack]}
        onClose={onClose}
        onNotify={onNotify}
      />,
    );

    const target = await screen.findByRole("button", { name: /Night drive/ });
    expect(within(target).getByText("1 track")).toBeInTheDocument();
    fireEvent.click(target);
    expect(await within(target).findByText("2 tracks")).toBeInTheDocument();

    pendingUpdate.reject(new Error("Add failed"));
    expect(await within(target).findByText("1 track")).toBeInTheDocument();
    expect(onNotify).toHaveBeenCalledWith("Add failed", "bad");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes Add to playlist with optimistic counts after a committed empty response", async () => {
    mocks.updatePlaylist.mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    const onNotify = vi.fn();
    const { queryClient } = withQueryClient(
      <AddToPlaylistDialog
        tracks={[secondTrack]}
        onClose={onClose}
        onNotify={onNotify}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Night drive/ }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(
      queryClient.getQueryData<PlaylistSummary[]>(["bandcamp", "playlists"]),
    ).toEqual([
      {
        ...summary,
        duration: summary.duration + secondTrack.duration,
        songCount: 2,
      },
    ]);
    expect(onNotify).toHaveBeenCalledWith(
      "1 track added to Night drive",
      "good",
    );
  });

  it("renders favorites and removes a starred track through the supplied action", () => {
    withQueryClient(<SavedLibraryView mode="favorites" {...commonProps} />);

    const favoriteTracks = screen.getByLabelText("Favorite tracks");
    expect(
      within(favoriteTracks).getByRole("button", { name: "Play Mirage" }),
    ).toHaveAttribute("data-slot", "row-playback-action");
    expect(
      within(favoriteTracks).getByRole("button", {
        name: "Add Mirage to queue",
      }).parentElement,
    ).toHaveAttribute("data-slot", "row-action-group");
    fireEvent.click(
      within(favoriteTracks).getByRole("button", {
        name: "Remove Mirage from favorites",
      }),
    );
    expect(commonProps.onToggleFavorite).toHaveBeenCalledWith(
      "song-1",
      "song",
      false,
    );
    fireEvent.click(
      within(favoriteTracks).getByRole("link", { name: "Sweeps" }),
    );
    expect(commonProps.onOpenArtist).toHaveBeenCalledWith(
      "Sweeps",
      "album-1",
      track,
      expect.any(HTMLElement),
    );
    const favoriteAlbumButton = within(favoriteTracks)
      .getAllByRole("link", { name: "Open Mirage album" })
      .find((link) => link.hasAttribute("data-coda-album-title-target"));
    if (!favoriteAlbumButton) throw new Error("Expected favorite album link");
    expect(favoriteAlbumButton).toHaveAttribute(
      "data-coda-album-title-target",
      "album-1",
    );
    expect(favoriteAlbumButton.closest("[data-album-card]")).toHaveAttribute(
      "data-album-card",
      "album-1",
    );
    fireEvent.click(favoriteAlbumButton);
    expect(commonProps.onOpenTrackAlbum).toHaveBeenCalledWith(
      track,
      favoriteAlbumButton,
    );
    fireEvent.click(
      screen.getByRole("link", {
        name: "Browse The Hip Hop Show",
      }),
    );
    expect(commonProps.onOpenRadioSeries).toHaveBeenCalledWith(5);
    expect(
      screen.getByRole("button", { name: "Play The Hip Hop Show" }),
    ).toHaveTextContent("Play");
    const radioSeriesLink = screen.getByRole("link", {
      name: "Browse The Hip Hop Show",
    });
    expect(
      radioSeriesLink.parentElement?.querySelector("time"),
    ).toHaveAttribute("dateTime", favorites.radioShows[0].publishedAt);
    expect(
      document.querySelector('[data-radio-show-artwork="979"] img'),
    ).toHaveAttribute("src", favorites.radioShows[0].artworkUrl);
    expect(
      screen.queryByText(favorites.radioShows[0].description ?? ""),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("link", {
        name: "Open The Hip Hop Show details",
      }),
    );
    expect(commonProps.onOpenRadioShow).toHaveBeenCalledWith(
      favorites.radioShows[0],
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove The Hip Hop Show from favorites",
      }),
    );
    expect(commonProps.onToggleRadioFavorite).toHaveBeenCalledWith(
      favorites.radioShows[0],
      false,
    );
    const favoriteReleases = screen
      .getByRole("heading", {
        name: "Releases",
      })
      .closest("section");
    if (!favoriteReleases) throw new Error("Expected favorite releases");
    const favoriteReleaseTitle = within(favoriteReleases).getByRole("link", {
      name: "Mirage",
    });
    expect(favoriteReleaseTitle).toHaveAttribute(
      "data-coda-album-title-target",
      "album-1",
    );
    expect(favoriteReleaseTitle.closest("[data-album-card]")).toHaveAttribute(
      "data-album-card",
      "album-1",
    );
  });

  it("exposes typed saved destinations without nesting actions or starting playback", async () => {
    const user = userEvent.setup();
    const { container, router } = withQueryClient(
      <SavedLibraryView mode="favorites" {...commonProps} />,
    );

    const favoriteTracks = screen.getByLabelText("Favorite tracks");
    const trackArtist = within(favoriteTracks).getByRole("link", {
      name: "Sweeps",
    });
    const trackAlbum = within(favoriteTracks)
      .getAllByRole("link", { name: "Open Mirage album" })
      .find((link) => link.hasAttribute("data-coda-album-title-target"));
    if (!trackAlbum) throw new Error("Expected favorite track album link");
    expect(trackArtist).toHaveAttribute(
      "href",
      "/collection/artists/sweeps?q=&genre=All&sort=recent&mode=artists&albumId=album-1",
    );
    expect(trackAlbum).toHaveAttribute(
      "href",
      "/collection/albums/album-1?q=&genre=All&sort=recent&mode=releases",
    );

    const releases = screen
      .getByRole("heading", { name: "Releases" })
      .closest("section");
    if (!releases) throw new Error("Expected favorite releases");
    expect(
      within(releases).getByRole("link", { name: "Open Mirage" }),
    ).toHaveAttribute("href", trackAlbum.getAttribute("href"));
    expect(
      within(releases).getByRole("link", { name: "Mirage" }),
    ).toHaveAttribute("href", trackAlbum.getAttribute("href"));
    expect(
      within(releases).getByRole("link", { name: "Sweeps" }),
    ).toHaveAttribute("href", trackArtist.getAttribute("href"));

    const radioShow = screen.getByRole("link", {
      name: "Open The Hip Hop Show details",
    });
    expect(radioShow).toHaveAttribute("href", "/radio/shows/979");
    expect(
      screen.getByRole("link", {
        name: "Open The Hip Hop Show episode",
      }),
    ).toHaveAttribute("href", "/radio/shows/979");
    expect(
      screen.getByRole("link", {
        name: "Browse The Hip Hop Show",
      }),
    ).toHaveAttribute("href", "/radio/series/5");

    expect(container.querySelector("a button, button a, a a")).toBeNull();

    trackAlbum.focus();
    await user.keyboard("{Enter}");
    expect(commonProps.onOpenTrackAlbum).toHaveBeenCalledWith(
      track,
      trackAlbum,
    );
    expect(commonProps.onPlayTrack).not.toHaveBeenCalled();
    expect(commonProps.onPlayTracks).not.toHaveBeenCalled();
    expect(commonProps.onTogglePlayback).not.toHaveBeenCalled();

    const preloadRoute = vi.spyOn(router, "preloadRoute");
    fireEvent.mouseEnter(radioShow);
    await waitFor(() => expect(preloadRoute).toHaveBeenCalled());
    expect(mocks.fetchRadioShow).not.toHaveBeenCalled();
  });

  it("marks every saved-library album destination busy while its album opens", async () => {
    const favoriteView = withQueryClient(
      <SavedLibraryView
        mode="favorites"
        {...commonProps}
        loadingAlbumId="album-1"
      />,
    );

    const releases = screen
      .getByRole("heading", { name: "Releases" })
      .closest("section");
    if (!releases) throw new Error("Expected a releases section");
    const artworkButton = within(releases).getByRole("link", {
      name: "Open Mirage",
    });
    const titleButton = within(releases).getByRole("link", {
      name: "Mirage",
    });

    expect(artworkButton).toHaveAttribute("aria-disabled", "true");
    expect(artworkButton).toHaveAttribute("aria-busy", "true");
    expect(
      within(artworkButton).getByRole("status", {
        name: "Loading Mirage artwork",
      }),
    ).toBeInTheDocument();
    expect(titleButton).toHaveAttribute("aria-disabled", "true");
    expect(titleButton).toHaveAttribute("aria-busy", "true");
    expect(
      within(titleButton).getByRole("status", {
        name: "Loading Mirage release",
      }),
    ).toBeInTheDocument();

    const favoriteTracks = screen.getByLabelText("Favorite tracks");
    const favoriteAlbumButton = within(favoriteTracks)
      .getAllByRole("link", { name: "Open Mirage album" })
      .find((link) => link.hasAttribute("data-coda-album-title-target"));
    if (!favoriteAlbumButton) throw new Error("Expected favorite album link");

    expect(favoriteAlbumButton).toHaveAttribute("aria-disabled", "true");
    expect(favoriteAlbumButton).toHaveAttribute("aria-busy", "true");
    expect(
      within(favoriteAlbumButton).getByRole("status", {
        name: "Loading Mirage album",
      }),
    ).toBeInTheDocument();
    favoriteView.unmount();

    withQueryClient(
      <SavedLibraryView
        mode="playlists"
        {...commonProps}
        loadingAlbumId="album-1"
      />,
    );

    fireEvent.click(await screen.findByRole("link", { name: /Night drive/ }));
    const playlistTracks = await screen.findByLabelText("Night drive tracks");
    const playlistAlbumButton = within(playlistTracks)
      .getAllByRole("link", { name: "Open Mirage album" })
      .find(
        (link) =>
          link.getAttribute("data-navigation-slot") === "playlist-track:song-1",
      );
    if (!playlistAlbumButton) throw new Error("Expected playlist album link");

    expect(playlistAlbumButton).toHaveAttribute("aria-disabled", "true");
    expect(playlistAlbumButton).toHaveAttribute("aria-busy", "true");
    expect(
      within(playlistAlbumButton).getByRole("status", {
        name: "Loading Mirage album",
      }),
    ).toBeInTheDocument();
  });

  it("matches playlist and track play controls to the current player state", async () => {
    const onTogglePlayback = vi.fn();
    withQueryClient(
      <SavedLibraryView
        mode="playlists"
        {...commonProps}
        currentTrackId="song-1"
        playing
        onTogglePlayback={onTogglePlayback}
      />,
    );

    fireEvent.click(await screen.findByRole("link", { name: /Night drive/ }));
    expect(
      await screen.findByRole("button", { name: "Pause Night drive" }),
    ).toHaveAttribute("aria-pressed", "true");
    const trackPause = screen.getByRole("button", { name: "Pause Mirage" });
    expect(trackPause).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(trackPause);
    expect(onTogglePlayback).toHaveBeenCalledOnce();
  });

  it("keeps virtualized playlist rows aligned to the 64px spacing contract", async () => {
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
        this.callback(
          [
            {
              borderBoxSize: [
                {
                  blockSize: bounds.height,
                  inlineSize: bounds.width,
                },
              ],
              contentRect: bounds,
              target,
            } as unknown as ResizeObserverEntry,
          ],
          this,
        );
      }
      unobserve() {}
    }
    globalThis.ResizeObserver = ResizeObserverMock;
    HTMLElement.prototype.getBoundingClientRect =
      function getBoundingClientRect() {
        const scrollElement = this.hasAttribute("data-coda-library-scroll");
        const top = scrollElement ? 0 : 90;
        const height = scrollElement ? 240 : 0;
        return {
          bottom: top + height,
          height,
          left: 0,
          right: 800,
          top,
          width: 800,
          x: 0,
          y: top,
          toJSON: () => undefined,
        };
      };

    try {
      const tracks = Array.from({ length: 300 }, (_, index): Track => ({
        ...track,
        id: `playlist-track-${index}`,
        title: `Playlist track ${index}`,
        track: index + 1,
      }));
      mocks.fetchPlaylist.mockResolvedValueOnce({
        ...detail,
        duration: tracks.reduce((total, item) => total + item.duration, 0),
        songCount: tracks.length,
        tracks,
      });
      withQueryClient(
        <div data-coda-library-scroll>
          <SavedLibraryView mode="playlists" {...commonProps} />
        </div>,
      );

      fireEvent.click(await screen.findByRole("link", { name: /Night drive/ }));
      const list = await screen.findByRole("list", {
        name: "Night drive tracks",
      });
      await waitFor(() => {
        const rows = within(list).getAllByRole("listitem");
        expect(rows.length).toBeGreaterThan(1);
        expect(rows.length).toBeLessThan(30);
      });
      expect(list).toHaveAttribute("data-virtualized", "true");
      const rows = within(list)
        .getAllByRole("listitem")
        .sort(
          (left, right) =>
            Number(left.dataset.index) - Number(right.dataset.index),
        )
        .slice(0, 2);
      const rowOffset = (element: HTMLElement) => {
        const match = element.style.transform.match(/translateY\((-?\d+)px\)/);
        return Number(match?.[1]);
      };
      expect(rows[0]).toHaveStyle({ height: "64px" });
      expect(rows[1]).toHaveStyle({ height: "64px" });
      expect(rowOffset(rows[1]) - rowOffset(rows[0])).toBe(64);
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect;
      globalThis.ResizeObserver = originalResizeObserver;
    }
  });

  it("keeps a large favorites list bounded while preserving current-track controls", async () => {
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
        this.callback(
          [
            {
              borderBoxSize: [
                {
                  blockSize: bounds.height,
                  inlineSize: bounds.width,
                },
              ],
              contentRect: bounds,
              target,
            } as unknown as ResizeObserverEntry,
          ],
          this,
        );
      }
      unobserve() {}
    }
    globalThis.ResizeObserver = ResizeObserverMock;
    HTMLElement.prototype.getBoundingClientRect =
      function getBoundingClientRect() {
        const scrollElement = this.hasAttribute("data-coda-library-scroll");
        const top = scrollElement ? 0 : 90;
        const height = scrollElement ? 240 : 0;
        return {
          bottom: top + height,
          height,
          left: 0,
          right: 800,
          top,
          width: 800,
          x: 0,
          y: top,
          toJSON: () => undefined,
        };
      };

    try {
      const tracks = Array.from({ length: 300 }, (_, index): Track => ({
        ...track,
        id: `favorite-track-${index}`,
        title: `Favorite track ${index}`,
        track: index + 1,
      }));
      const largeFavorites: LocalFavoriteCollection = {
        albumIds: [],
        albums: [],
        radioShowIds: [],
        radioShows: [],
        songIds: tracks.map((item) => item.id),
        tracks,
      };
      const onTogglePlayback = vi.fn();
      withQueryClient(
        <div data-coda-library-scroll>
          <SavedLibraryView
            mode="favorites"
            {...commonProps}
            currentTrackId={tracks[0].id}
            favorites={largeFavorites}
            onTogglePlayback={onTogglePlayback}
            playing
          />
        </div>,
      );

      const list = screen.getByRole("list", { name: "Favorite tracks" });
      await waitFor(() => {
        const rows = within(list).getAllByRole("listitem");
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.length).toBeLessThan(30);
      });
      const pause = screen.getByRole("button", {
        name: "Pause Favorite track 0",
      });
      expect(pause).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(pause);
      expect(onTogglePlayback).toHaveBeenCalledOnce();
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect;
      globalThis.ResizeObserver = originalResizeObserver;
    }
  });

  it("keeps large favorite release and Radio grids bounded with working visible actions", async () => {
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
        this.callback(
          [
            {
              borderBoxSize: [
                {
                  blockSize: bounds.height,
                  inlineSize: bounds.width,
                },
              ],
              contentRect: bounds,
              target,
            } as unknown as ResizeObserverEntry,
          ],
          this,
        );
      }
      unobserve() {}
    }
    globalThis.ResizeObserver = ResizeObserverMock;
    HTMLElement.prototype.getBoundingClientRect =
      function getBoundingClientRect() {
        const scrollElement = this.hasAttribute("data-coda-library-scroll");
        const top = scrollElement ? 0 : 90;
        const height = scrollElement ? 240 : 0;
        return {
          bottom: top + height,
          height,
          left: 0,
          right: 800,
          top,
          width: 800,
          x: 0,
          y: top,
          toJSON: () => undefined,
        };
      };

    try {
      const albums = Array.from({ length: 5_000 }, (_, index) => ({
        ...favorites.albums[0],
        id: `favorite-album-${index}`,
        title: `Favorite release ${index}`,
      }));
      const radioShows = Array.from({ length: 5_000 }, (_, index) => ({
        ...favorites.radioShows[0],
        id: 10_000 + index,
        subtitle: `Favorite Radio show ${index}`,
      }));
      const largeFavorites: LocalFavoriteCollection = {
        albumIds: albums.map((album) => album.id),
        albums,
        radioShowIds: radioShows.map((show) => show.id),
        radioShows,
        songIds: [],
        tracks: [],
      };
      const onTogglePlayback = vi.fn();
      const onToggleFavorite = vi.fn();
      const onToggleRadioFavorite = vi.fn();
      const onOpenAlbum = vi.fn();
      withQueryClient(
        <div data-coda-library-scroll>
          <SavedLibraryView
            mode="favorites"
            {...commonProps}
            currentTrackId={`radio:${radioShows[0].id}`}
            favorites={largeFavorites}
            onOpenAlbum={onOpenAlbum}
            onToggleFavorite={onToggleFavorite}
            onTogglePlayback={onTogglePlayback}
            onToggleRadioFavorite={onToggleRadioFavorite}
            playing
          />
        </div>,
      );

      const radioGrid = screen.getByRole("list", {
        name: "Favorite radio shows",
      });
      const releaseGrid = screen.getByRole("list", {
        name: "Favorite releases",
      });
      await waitFor(() => {
        expect(radioGrid).toHaveAttribute("data-virtualized", "true");
        expect(releaseGrid).toHaveAttribute("data-virtualized", "true");
        expect(within(radioGrid).getAllByRole("listitem").length).toBeLessThan(
          50,
        );
        expect(
          within(releaseGrid).getAllByRole("listitem").length,
        ).toBeLessThan(50);
      });
      expect(within(radioGrid).getAllByRole("listitem")[0]).toHaveAttribute(
        "aria-setsize",
        "5000",
      );
      expect(within(releaseGrid).getAllByRole("listitem")[0]).toHaveAttribute(
        "aria-setsize",
        "5000",
      );

      fireEvent.click(
        within(radioGrid).getByRole("button", {
          name: "Pause Favorite Radio show 0",
        }),
      );
      expect(onTogglePlayback).toHaveBeenCalledOnce();
      fireEvent.click(
        within(radioGrid).getByRole("button", {
          name: "Remove Favorite Radio show 0 from favorites",
        }),
      );
      expect(onToggleRadioFavorite).toHaveBeenCalledWith(radioShows[0], false);

      const openRelease = within(releaseGrid).getByRole("link", {
        name: "Open Favorite release 0",
      });
      fireEvent.click(openRelease);
      expect(onOpenAlbum).toHaveBeenCalledWith(albums[0], openRelease);
      fireEvent.click(
        within(releaseGrid).getByRole("button", {
          name: "Remove Favorite release 0 from favorites",
        }),
      );
      expect(onToggleFavorite).toHaveBeenCalledWith(
        albums[0].id,
        "album",
        false,
      );
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect;
      globalThis.ResizeObserver = originalResizeObserver;
    }
  });

  it("keeps 5,000 playlist cards bounded while preserving optimistic create and open", async () => {
    const restoreViewport = mockVirtualizedViewport({
      contentTop: 90,
      height: 240,
      isScrollElement: (element) =>
        element.hasAttribute("data-coda-library-scroll"),
      width: 800,
    });
    const playlists = Array.from({ length: 5_000 }, (_, index) => ({
      duration: 0,
      id: `playlist-${index}`,
      name: `Playlist ${index}`,
      songCount: 0,
    }));
    const pendingCreate = deferred<PlaylistDetail>();
    const pendingOpen = deferred<PlaylistDetail>();
    mocks.fetchPlaylists.mockResolvedValueOnce(playlists);
    mocks.createPlaylist.mockReturnValueOnce(pendingCreate.promise);
    mocks.fetchPlaylist.mockReturnValueOnce(pendingOpen.promise);

    try {
      withQueryClient(
        <div data-coda-library-scroll>
          <SavedLibraryView mode="playlists" {...commonProps} />
        </div>,
      );

      const list = await screen.findByRole("list", { name: "Playlists" });
      await waitFor(() => {
        expect(list).toHaveAttribute("data-virtualized", "true");
        const cards = within(list).getAllByRole("listitem");
        expect(cards.length).toBeGreaterThan(0);
        expect(cards.length).toBeLessThan(40);
      });
      expect(within(list).getAllByRole("listitem")[0]).toHaveAttribute(
        "aria-setsize",
        "5000",
      );

      fireEvent.change(screen.getByPlaceholderText("Late-night rotation"), {
        target: { value: "Fresh finds" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Create" }));
      const optimistic = await within(list).findByRole("link", {
        name: /Fresh finds/,
      });
      expect(optimistic).toHaveAttribute("aria-disabled", "true");
      expect(within(optimistic).getByText("Creating…")).toBeInTheDocument();
      expect(within(list).getAllByRole("listitem").length).toBeLessThan(40);

      pendingCreate.reject(new Error("Create failed"));
      await waitFor(() =>
        expect(
          within(list).queryByRole("link", { name: /Fresh finds/ }),
        ).not.toBeInTheDocument(),
      );

      fireEvent.click(
        within(within(list).getAllByRole("listitem")[0]).getByRole("link"),
      );
      expect(await screen.findByText("Loading playlist")).toBeInTheDocument();
      expect(mocks.fetchPlaylist).toHaveBeenCalledWith("playlist-0");
    } finally {
      await act(async () => {
        pendingOpen.resolve({
          ...detail,
          id: "playlist-0",
          name: "Playlist 0",
        });
        await Promise.resolve();
      });
      restoreViewport();
    }
  });

  it("keeps 5,000 Add-to-playlist rows bounded with a focused pending add", async () => {
    const restoreViewport = mockVirtualizedViewport({
      contentTop: 0,
      height: 280,
      isScrollElement: (element) =>
        element.hasAttribute("data-add-to-playlist-scroll"),
      width: 464,
    });
    const playlists = Array.from({ length: 5_000 }, (_, index) => ({
      duration: 0,
      id: `dialog-playlist-${index}`,
      name: `Dialog playlist ${index}`,
      songCount: 0,
    }));
    const pendingAdd = deferred<PlaylistDetail>();
    const onClose = vi.fn();
    const onNotify = vi.fn();
    mocks.fetchPlaylists.mockResolvedValueOnce(playlists);
    mocks.updatePlaylist.mockReturnValueOnce(pendingAdd.promise);

    try {
      withQueryClient(
        <AddToPlaylistDialog
          tracks={[track]}
          onClose={onClose}
          onNotify={onNotify}
        />,
      );

      const list = await screen.findByRole("list", {
        name: "Available playlists",
      });
      await waitFor(() => {
        expect(list).toHaveAttribute("data-virtualized", "true");
        const rows = within(list).getAllByRole("listitem");
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.length).toBeLessThan(40);
      });
      expect(within(list).getAllByRole("listitem")[0]).toHaveAttribute(
        "aria-setsize",
        "5000",
      );

      const target = within(within(list).getAllByRole("listitem")[0]).getByRole(
        "button",
      );
      target.focus();
      expect(target).toHaveFocus();
      fireEvent.click(target);
      await waitFor(() => expect(target).toBeDisabled());
      expect(target).toHaveFocus();
      expect(target.querySelector('[data-slot="spinner"]')).toBeInTheDocument();
      expect(await within(target).findByText("1 track")).toBeInTheDocument();
      expect(within(list).getAllByRole("listitem").length).toBeLessThan(40);
      expect(mocks.updatePlaylist).toHaveBeenCalledWith({
        playlistId: playlists[0].id,
        songIdsToAdd: [track.id],
      });

      pendingAdd.reject(new Error("Add failed"));
      expect(await within(target).findByText("0 tracks")).toBeInTheDocument();
      expect(onNotify).toHaveBeenCalledWith("Add failed", "bad");
      expect(onClose).not.toHaveBeenCalled();
    } finally {
      restoreViewport();
    }
  });
});
