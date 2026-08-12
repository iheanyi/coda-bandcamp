import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type SavedLibraryRuntimeValue } from "@/features/saved-library/SavedLibraryRuntimeContext";
import { SavedLibraryRuntimeProvider } from "@/features/saved-library/SavedLibraryRuntimeProvider";
import { createLibrarySessionController } from "@/features/library-session";
import { createCodaMemoryRouter } from "@/router";
import type { PlaylistDetail, PlaylistSummary, Track } from "@/types";

const mocks = vi.hoisted(() => ({
  fetchPlaylist: vi.fn(),
  fetchPlaylists: vi.fn(),
}));

vi.mock("@/App", async () => {
  const { Outlet } = await import("@tanstack/react-router");
  return { default: Outlet };
});

vi.mock("@/lib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib")>();
  return {
    ...actual,
    fetchPlaylist: mocks.fetchPlaylist,
    fetchPlaylists: mocks.fetchPlaylists,
  };
});

const track: Track = {
  album: "Mirage",
  albumId: "album-1",
  artist: "Sweeps",
  duration: 188,
  id: "song-1",
  palette: ["#a66", "#222"],
  title: "Mirage",
  track: 1,
};

const summary: PlaylistSummary = {
  duration: 188,
  id: "playlist-1",
  name: "Night drive",
  songCount: 1,
};

const detail: PlaylistDetail = {
  ...summary,
  tracks: [track],
};

const runtime: SavedLibraryRuntimeValue = {
  connected: true,
  favoritesLoading: false,
  onAddToPlaylist: vi.fn(),
  onNotify: vi.fn(),
  onOpenAlbum: vi.fn(),
  onOpenArtist: vi.fn(),
  onOpenRadioSeries: vi.fn(),
  onOpenRadioShow: vi.fn(),
  onOpenTrackAlbum: vi.fn(),
  onPlayTrack: vi.fn(),
  onPlayTracks: vi.fn(),
  onQueueTrack: vi.fn(),
  onQueueTracks: vi.fn(),
  onRefreshFavorites: vi.fn(),
  onToggleFavorite: vi.fn(),
  onTogglePlayback: vi.fn(),
  onToggleRadioFavorite: vi.fn(),
  playing: false,
};

type TransitionSnapshot = {
  afterDetail?: string;
  afterReturn?: string;
  afterTitleReturn?: string;
  beforeDetail?: string;
  beforeSource?: string;
  className: string;
};

function renderPlaylistRoute(initialEntry = "/playlists") {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  const librarySession = createLibrarySessionController({ queryClient });
  librarySession.commands.acceptConnectedLibrary([], { announce: false });
  queryClient.setQueryData(["bandcamp", "playlists", summary.id], detail);
  const router = createCodaMemoryRouter(
    queryClient,
    [initialEntry],
    librarySession,
  );
  render(
    <QueryClientProvider client={queryClient}>
      <SavedLibraryRuntimeProvider value={runtime}>
        <div
          data-coda-library-scroll
          style={{ height: 600, overflowY: "auto" }}
        >
          <RouterProvider router={router} />
        </div>
      </SavedLibraryRuntimeProvider>
    </QueryClientProvider>,
  );
  return { queryClient, router };
}

const originalStartViewTransition = Object.getOwnPropertyDescriptor(
  document,
  "startViewTransition",
);

beforeEach(() => {
  vi.stubEnv("VITE_CODA_MOTION_VIEW_TRANSITIONS", "0");
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  mocks.fetchPlaylist.mockReset().mockResolvedValue(detail);
  mocks.fetchPlaylists.mockReset().mockResolvedValue([summary]);
  Object.values(runtime).forEach((value) => {
    if (vi.isMockFunction(value)) value.mockClear();
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  document.documentElement.classList.remove(
    "coda-transition--playlist-detail",
    "coda-transition--playlist-detail-close",
  );
  if (originalStartViewTransition) {
    Object.defineProperty(
      document,
      "startViewTransition",
      originalStartViewTransition,
    );
  } else {
    Reflect.deleteProperty(document, "startViewTransition");
  }
});

describe("Playlist file routes", () => {
  it("activates a typed playlist link from the keyboard without starting playback", async () => {
    const user = userEvent.setup();
    const { router } = renderPlaylistRoute();
    const playlistLink = await screen.findByRole("link", {
      name: /Night drive/u,
    });

    expect(playlistLink).toHaveAttribute("href", "/playlists/playlist-1");
    expect(playlistLink.querySelector("a, button")).toBeNull();

    playlistLink.focus();
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/playlists/playlist-1");
    });
    expect(runtime.onPlayTrack).not.toHaveBeenCalled();
    expect(runtime.onPlayTracks).not.toHaveBeenCalled();
    expect(runtime.onTogglePlayback).not.toHaveBeenCalled();
  });

  it("restores the exact list trigger, scroll, and shared identity after detail Back", async () => {
    const snapshots: TransitionSnapshot[] = [];
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: vi.fn((update: () => void | Promise<void>) => {
        const snapshot: TransitionSnapshot = {
          beforeDetail: document.querySelector<HTMLElement>(
            "[data-coda-playlist-identity-detail]",
          )?.dataset.codaPlaylistIdentityDetail,
          beforeSource: document.querySelector<HTMLElement>(
            "[data-coda-playlist-identity-source]",
          )?.dataset.codaPlaylistIdentitySource,
          className: document.documentElement.className,
        };
        const updateCallbackDone = Promise.resolve(update()).then(() => {
          snapshot.afterDetail = document.querySelector<HTMLElement>(
            "[data-coda-playlist-identity-detail]",
          )?.dataset.codaPlaylistIdentityDetail;
          snapshot.afterReturn = document.querySelector<HTMLElement>(
            "[data-coda-playlist-identity-return]",
          )?.dataset.codaPlaylistIdentityReturn;
          snapshot.afterTitleReturn = document.querySelector<HTMLElement>(
            "[data-coda-playlist-title-return]",
          )?.dataset.codaPlaylistTitleReturn;
          snapshots.push(snapshot);
        });
        return {
          finished: updateCallbackDone,
          updateCallbackDone,
        };
      }),
    });

    const { router } = renderPlaylistRoute();
    const scrollRoot = document.querySelector<HTMLElement>(
      "[data-coda-library-scroll]",
    );
    expect(scrollRoot).not.toBeNull();
    if (scrollRoot) scrollRoot.scrollTop = 173;

    const openPlaylist = await screen.findByRole("link", {
      name: /Night drive/u,
    });
    expect(openPlaylist).toHaveAttribute("href", "/playlists/playlist-1");
    openPlaylist.focus();
    fireEvent.click(openPlaylist);

    expect(
      await screen.findByRole("heading", { name: summary.name }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/playlists/playlist-1");
    });

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    const restoredTrigger = await screen.findByRole("link", {
      name: /Night drive/u,
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/playlists");
      expect(restoredTrigger).toHaveFocus();
      expect(scrollRoot?.scrollTop).toBe(173);
    });

    expect(snapshots).toHaveLength(2);
    expect(snapshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          afterDetail: summary.id,
          beforeSource: summary.id,
          className: expect.stringContaining(
            "coda-transition--playlist-detail",
          ),
        }),
        expect.objectContaining({
          afterReturn: summary.id,
          afterTitleReturn: summary.id,
          beforeDetail: summary.id,
          className: expect.stringContaining(
            "coda-transition--playlist-detail-close",
          ),
        }),
      ]),
    );
    await waitFor(() => {
      expect(
        document.querySelectorAll(
          "[data-coda-playlist-identity-return], [data-coda-playlist-title-return]",
        ),
      ).toHaveLength(0);
    });
  });
});
