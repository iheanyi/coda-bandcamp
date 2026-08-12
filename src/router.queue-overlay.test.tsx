import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodaMotionProvider } from "@/MotionProvider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createCodaMemoryRouter } from "@/router";
import type { LocalFavoriteCollection, PlayerStateSnapshot } from "@/types";

const nativeMocks = vi.hoisted(() => ({
  checkpointPlayerState: vi.fn(),
  fetchCoverUrl: vi.fn(),
  fetchLibrary: vi.fn(),
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
    fetchCoverUrl: nativeMocks.fetchCoverUrl,
    fetchLibrary: nativeMocks.fetchLibrary,
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

const restoredPlayerState: PlayerStateSnapshot = {
  version: 1,
  savedAt: 1,
  queue: [
    {
      id: "persistent-track",
      title: "Persistent Signal",
      artist: "Root Shell",
      album: "Overlay Contract",
      albumId: "overlay-album",
      duration: 180,
      track: 1,
      palette: ["#777", "#222"],
    },
  ],
  currentIndex: 0,
  positionSeconds: 0,
  volume: 0.72,
  repeatMode: "off",
  queueOpen: true,
};

beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  window.localStorage.clear();

  nativeMocks.checkpointPlayerState.mockReset().mockResolvedValue(true);
  nativeMocks.fetchCoverUrl
    .mockReset()
    .mockResolvedValue("https://example.test/test-cover.jpg");
  nativeMocks.fetchLibrary.mockReset().mockResolvedValue([]);
  nativeMocks.fetchStreamUrl
    .mockReset()
    .mockResolvedValue("https://example.test/test.mp3");
  nativeMocks.getLastFmStatus.mockReset().mockResolvedValue({
    configured: false,
    connected: false,
  });
  nativeMocks.hasConnection.mockReset().mockResolvedValue(false);
  nativeMocks.loadPlayerState
    .mockReset()
    .mockResolvedValue(restoredPlayerState);
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

describe("root-owned queue overlay", () => {
  it("stays mounted and non-reflowing across generated route navigation", async () => {
    const user = userEvent.setup();
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

    const queueDrawer = await screen.findByRole("dialog", { name: "Queue" });
    const main = screen.getByRole("main");
    const shell = main.parentElement;
    expect(queueDrawer).toHaveAttribute("id", "queue-drawer");
    expect(queueDrawer).toHaveClass("fixed");
    expect(shell).toHaveAttribute("data-queue-open", "true");

    await user.click(screen.getByRole("link", { name: "Recently added" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/recent");
    });

    expect(screen.getByRole("dialog", { name: "Queue" })).toBe(queueDrawer);
    expect(screen.getByRole("main")).toBe(main);
    expect(main.parentElement).toBe(shell);
    expect(shell).toHaveAttribute("data-queue-open", "true");
    expect(queueDrawer).toHaveClass("fixed");
  });
});
