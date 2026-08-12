import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodaMotionProvider } from "@/MotionProvider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createCodaMemoryRouter } from "@/router";
import type { Album, LocalFavoriteCollection, Track } from "@/types";

const nativeMocks = vi.hoisted(() => ({
  checkpointPlayerState: vi.fn(),
  fetchAlbum: vi.fn(),
  fetchCoverUrl: vi.fn(),
  fetchLibrary: vi.fn(),
  fetchRadioShow: vi.fn(),
  fetchStreamUrl: vi.fn(),
  getLastFmStatus: vi.fn(),
  hasConnection: vi.fn(),
  loadPlayerState: vi.fn(),
  readLocalFavorites: vi.fn(),
  savePlayerState: vi.fn(),
  writeLocalFavorites: vi.fn(),
}));

vi.mock("@/lib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib")>();
  return {
    ...actual,
    checkpointPlayerState: nativeMocks.checkpointPlayerState,
    fetchAlbum: nativeMocks.fetchAlbum,
    fetchCoverUrl: nativeMocks.fetchCoverUrl,
    fetchLibrary: nativeMocks.fetchLibrary,
    fetchRadioShow: nativeMocks.fetchRadioShow,
    fetchStreamUrl: nativeMocks.fetchStreamUrl,
    getLastFmStatus: nativeMocks.getLastFmStatus,
    hasConnection: nativeMocks.hasConnection,
    isDesktop: () => false,
    loadPlayerState: nativeMocks.loadPlayerState,
    savePlayerState: nativeMocks.savePlayerState,
  };
});

vi.mock("@/localFavoritesStore", () => ({
  readLocalFavoritesAsync: nativeMocks.readLocalFavorites,
  writeLocalFavoritesAsync: nativeMocks.writeLocalFavorites,
}));

const emptyFavorites: LocalFavoriteCollection = {
  albumIds: [],
  songIds: [],
  radioShowIds: [],
  albums: [],
  tracks: [],
  radioShows: [],
};

const initialRouteAlbum: Album = {
  id: "album-1",
  title: "Soft Focus",
  artist: "Night Archive",
  songCount: 1,
  duration: 180,
  genre: "Ambient",
  palette: ["#777", "#222"],
};

const initialRouteTracks: Track[] = [
  {
    id: "track-1",
    title: "First Light",
    artist: "Night Archive",
    album: "Soft Focus",
    albumId: "album-1",
    duration: 180,
    track: 1,
    palette: ["#777", "#222"],
  },
];

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  window.localStorage.clear();

  nativeMocks.checkpointPlayerState.mockReset().mockResolvedValue(true);
  nativeMocks.fetchAlbum.mockReset();
  nativeMocks.fetchCoverUrl
    .mockReset()
    .mockResolvedValue("https://example.test/test-cover.jpg");
  nativeMocks.fetchLibrary.mockReset().mockResolvedValue([]);
  nativeMocks.fetchRadioShow.mockReset();
  nativeMocks.fetchStreamUrl
    .mockReset()
    .mockResolvedValue("https://example.test/test.mp3");
  nativeMocks.getLastFmStatus.mockReset().mockResolvedValue({
    configured: false,
    connected: false,
  });
  nativeMocks.hasConnection.mockReset().mockResolvedValue(false);
  nativeMocks.loadPlayerState.mockReset().mockResolvedValue(undefined);
  nativeMocks.readLocalFavorites.mockReset().mockResolvedValue(emptyFavorites);
  nativeMocks.savePlayerState.mockReset().mockResolvedValue(undefined);
  nativeMocks.writeLocalFavorites
    .mockReset()
    .mockImplementation(
      async (favorites: LocalFavoriteCollection) => favorites,
    );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("root route provider order", () => {
  it("renders Collection through the provider-backed application shell", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    });
    const router = createCodaMemoryRouter(queryClient, ["/collection"]);

    render(
      <CodaMotionProvider>
        <TooltipProvider>
          <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
          </QueryClientProvider>
        </TooltipProvider>
      </CodaMotionProvider>,
    );

    expect(
      await screen.findByRole("heading", {
        name: "Your collection starts here",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Collection" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Coda couldn’t open this page"),
    ).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/collection");
  });

  it("hydrates an initial album route after startup resolves connected", async () => {
    const tracks = deferred<Track[]>();
    nativeMocks.hasConnection.mockResolvedValue(true);
    nativeMocks.fetchLibrary.mockResolvedValue([initialRouteAlbum]);
    nativeMocks.fetchAlbum.mockReturnValue(tracks.promise);
    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    });
    const router = createCodaMemoryRouter(queryClient, [
      "/collection/albums/album-1",
    ]);

    render(
      <CodaMotionProvider>
        <TooltipProvider>
          <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
          </QueryClientProvider>
        </TooltipProvider>
      </CodaMotionProvider>,
    );

    const albumPage = await screen.findByRole("article", {
      name: "Soft Focus release details",
    });
    expect(
      within(albumPage).getByRole("status", { name: "Loading album tracks" }),
    ).toBeInTheDocument();
    expect(nativeMocks.fetchAlbum).toHaveBeenCalledOnce();

    await act(async () => tracks.resolve(initialRouteTracks));

    expect(
      await within(albumPage).findByText("First Light"),
    ).toBeInTheDocument();
    expect(
      within(albumPage).queryByText("No playable tracks returned"),
    ).not.toBeInTheDocument();
    expect(nativeMocks.fetchAlbum).toHaveBeenCalledOnce();
  });
});
