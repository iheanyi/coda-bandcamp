import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodaMotionProvider } from "@/MotionProvider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createCodaMemoryRouter } from "@/router";
import type { PlayerStateSnapshot } from "@/types";

const nativeMocks = {
  checkpointPlayerState: vi.fn(),
  fetchLibrary: vi.fn(),
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
      case "fetch_library":
        return nativeMocks.fetchLibrary(payload);
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
  clearMocks();
  installNativeRuntime();
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  window.localStorage.clear();

  nativeMocks.checkpointPlayerState.mockReset().mockResolvedValue(true);
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
  nativeMocks.savePlayerState.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  clearMocks();
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
