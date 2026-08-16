import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodaMotionProvider } from "@/MotionProvider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createCodaMemoryRouter } from "@/router";
import type { Album, Track } from "@/types";

const nativeMocks = {
  checkpointPlayerState: vi.fn(),
  fetchAlbum: vi.fn(),
  fetchLibrary: vi.fn(),
  fetchRadioShow: vi.fn(),
  fetchStreamUrl: vi.fn(),
  getLastFmStatus: vi.fn(),
  hasConnection: vi.fn(),
  loadPlayerState: vi.fn(),
  savePlayerState: vi.fn(),
};

function installNativeRuntime() {
  mockIPC((command, payload) => {
    switch (command) {
      case "checkpoint_player_state":
        return nativeMocks.checkpointPlayerState(payload);
      case "fetch_album":
        return nativeMocks.fetchAlbum(payload);
      case "fetch_library":
        return nativeMocks.fetchLibrary(payload);
      case "radio_show":
        return nativeMocks.fetchRadioShow(payload);
      case "get_stream_url":
        return nativeMocks.fetchStreamUrl(payload);
      case "lastfm_status":
        return nativeMocks.getLastFmStatus();
      case "has_connection":
        return nativeMocks.hasConnection();
      case "load_player_state":
        return nativeMocks.loadPlayerState();
      case "save_player_state":
        return nativeMocks.savePlayerState(payload);
      case "load_library_cache":
        return Promise.resolve(null);
      case "player_state_contract_version":
        return Promise.resolve(2);
      case "record_player_state_diagnostic":
      case "update_system_media_metadata":
      case "update_system_media_playback":
      case "update_system_media_timeline":
        return Promise.resolve();
      default:
        if (command.startsWith("plugin:")) return Promise.resolve();
        return Promise.reject(new Error(`Unexpected native command: ${command}`));
    }
  });
}

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
  clearMocks();
  installNativeRuntime();
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  window.localStorage.clear();

  nativeMocks.checkpointPlayerState.mockReset().mockResolvedValue(true);
  nativeMocks.fetchAlbum.mockReset();
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
  nativeMocks.savePlayerState.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  clearMocks();
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
