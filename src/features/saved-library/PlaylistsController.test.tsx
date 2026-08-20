import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterContextProvider } from "@tanstack/react-router";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { CodaMotionProvider } from "@/MotionProvider";
import {
  PLAYLISTS_QUERY_KEY,
  playlistQueryKey,
} from "@/queries/savedLibraryQueries";
import { createCodaMemoryRouter } from "@/router";
import { parsePlaylistIdParam } from "@/routing/routeContracts";
import {
  commonProps,
  detail,
  mocks,
  summary,
} from "@/test/savedLibraryViewTestHarness";
import type { PlaylistDetail } from "@/types";

import { PlaylistsController } from "./PlaylistsController";
import {
  SavedLibraryRuntimeContext,
  type SavedLibraryRuntimeValue,
} from "./SavedLibraryRuntimeContext";

const playlistId = parsePlaylistIdParam(summary.id);

function trackUnhandledRejections() {
  const handler = vi.fn((event: PromiseRejectionEvent) => {
    event.preventDefault();
  });
  window.addEventListener("unhandledrejection", handler);
  return {
    handler,
    stop: () => window.removeEventListener("unhandledrejection", handler),
  };
}

function renderPlaylistsController(
  ui: ReactNode,
  options?: {
    seed?: (queryClient: QueryClient) => void;
    initialEntry?: string;
    runtime?: SavedLibraryRuntimeValue;
  },
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  options?.seed?.(queryClient);
  const router = createCodaMemoryRouter(queryClient, [
    options?.initialEntry ?? "/playlists",
  ]);
  return {
    ...render(
      <CodaMotionProvider>
        <QueryClientProvider client={queryClient}>
          <SavedLibraryRuntimeContext.Provider
            value={options?.runtime ?? commonProps}
          >
            <RouterContextProvider router={router}>{ui}</RouterContextProvider>
          </SavedLibraryRuntimeContext.Provider>
        </QueryClientProvider>
      </CodaMotionProvider>,
    ),
    queryClient,
    router,
  };
}

function seedPlaylists(queryClient: QueryClient) {
  queryClient.setQueryData(PLAYLISTS_QUERY_KEY, [summary]);
}

function seedPlaylistDetail(queryClient: QueryClient) {
  queryClient.setQueryData(playlistQueryKey(summary.id), detail);
}

describe("PlaylistsController navigation rejections", () => {
  it("reports an open failure and clears the opening state", async () => {
    const unhandled = trackUnhandledRejections();
    const onNotify = vi.fn();
    const onOpenPlaylist = vi.fn().mockRejectedValue(new Error("Open failed"));
    renderPlaylistsController(
      <PlaylistsController
        onOpenPlaylist={onOpenPlaylist}
        screen="index"
      />,
      { seed: seedPlaylists, runtime: { ...commonProps, onNotify } },
    );

    fireEvent.click(await screen.findByRole("link", { name: /Night drive/ }));
    expect(await screen.findByText("Opening…")).toBeInTheDocument();

    await waitFor(() => {
      expect(onNotify).toHaveBeenCalledWith("Open failed", "bad");
    });
    expect(screen.queryByText("Opening…")).not.toBeInTheDocument();
    expect(unhandled.handler).not.toHaveBeenCalled();
    unhandled.stop();
  });

  it("does not treat a same-location open as a navigation failure", async () => {
    const onNotify = vi.fn();
    const onOpenPlaylist = vi.fn().mockResolvedValue("same-location");
    renderPlaylistsController(
      <PlaylistsController
        onOpenPlaylist={onOpenPlaylist}
        screen="index"
      />,
      { seed: seedPlaylists, runtime: { ...commonProps, onNotify } },
    );

    fireEvent.click(await screen.findByRole("link", { name: /Night drive/ }));

    await waitFor(() => {
      expect(onOpenPlaylist).toHaveBeenCalled();
      expect(screen.queryByText("Opening…")).not.toBeInTheDocument();
    });
    expect(onNotify).not.toHaveBeenCalled();
  });

  it("reports a post-create open failure without an unhandled rejection", async () => {
    const unhandled = trackUnhandledRejections();
    const created: PlaylistDetail = {
      ...detail,
      id: "playlist-created",
      name: "Fresh finds",
    };
    mocks.createPlaylist.mockResolvedValueOnce(created);
    const onNotify = vi.fn();
    const onOpenPlaylist = vi.fn().mockRejectedValue(new Error("Open failed"));
    renderPlaylistsController(
      <PlaylistsController
        onOpenPlaylist={onOpenPlaylist}
        screen="index"
      />,
      { seed: seedPlaylists, runtime: { ...commonProps, onNotify } },
    );

    fireEvent.change(await screen.findByPlaceholderText("Late-night rotation"), {
      target: { value: "Fresh finds" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(onNotify).toHaveBeenCalledWith("Fresh finds created", "good");
      expect(onNotify).toHaveBeenCalledWith("Open failed", "bad");
    });
    expect(onOpenPlaylist).toHaveBeenCalled();
    expect(unhandled.handler).not.toHaveBeenCalled();
    unhandled.stop();
  });

  it("reports a Back failure without an unhandled rejection", async () => {
    const unhandled = trackUnhandledRejections();
    const onNotify = vi.fn();
    const onBack = vi.fn().mockRejectedValue(new Error("Leave failed"));
    const onReplaceIndex = vi.fn().mockResolvedValue("rendered");
    renderPlaylistsController(
      <PlaylistsController
        onBack={onBack}
        onReplaceIndex={onReplaceIndex}
        playlistId={playlistId}
        screen="detail"
      />,
      { seed: seedPlaylistDetail, runtime: { ...commonProps, onNotify } },
    );

    fireEvent.click(await screen.findByRole("button", { name: "Back" }));

    await waitFor(() => {
      expect(onNotify).toHaveBeenCalledWith("Leave failed", "bad");
    });
    expect(screen.getByRole("heading", { name: "Night drive" })).toBeInTheDocument();
    expect(unhandled.handler).not.toHaveBeenCalled();
    unhandled.stop();
  });

  it("reports a Back timeout in human copy without an unhandled rejection", async () => {
    const unhandled = trackUnhandledRejections();
    const onNotify = vi.fn();
    const onBack = vi.fn().mockResolvedValue("timeout");
    renderPlaylistsController(
      <PlaylistsController
        onBack={onBack}
        onReplaceIndex={vi.fn().mockResolvedValue("rendered")}
        playlistId={playlistId}
        screen="detail"
      />,
      { seed: seedPlaylistDetail, runtime: { ...commonProps, onNotify } },
    );

    fireEvent.click(await screen.findByRole("button", { name: "Back" }));

    await waitFor(() => {
      expect(onNotify).toHaveBeenCalledWith(
        "Playlist navigation took too long. Try again.",
        "bad",
      );
    });
    expect(unhandled.handler).not.toHaveBeenCalled();
    unhandled.stop();
  });

  it.each(["failed", "timeout"] as const)(
    "replaces a deleted playlist route when Back reports %s",
    async (outcome) => {
      const unhandled = trackUnhandledRejections();
      const user = userEvent.setup();
      const onNotify = vi.fn();
      const onBack = vi.fn().mockResolvedValue(outcome);
      const onReplaceIndex = vi.fn().mockResolvedValue("rendered");
      mocks.fetchPlaylist.mockRejectedValue(new Error("Playlist is gone"));
      const { queryClient } = renderPlaylistsController(
        <PlaylistsController
          onBack={onBack}
          onReplaceIndex={onReplaceIndex}
          playlistId={playlistId}
          screen="detail"
        />,
        {
          seed: (queryClient) => {
            seedPlaylists(queryClient);
            seedPlaylistDetail(queryClient);
          },
          runtime: { ...commonProps, onNotify },
        },
      );

      await user.click(
        await screen.findByRole("button", { name: "Delete playlist" }),
      );
      await user.click(
        screen.getByRole("button", { name: "Delete playlist from Bandcamp" }),
      );

      await waitFor(() => {
        expect(mocks.deletePlaylist).toHaveBeenCalledWith(summary.id);
        expect(onBack).toHaveBeenCalled();
        expect(onReplaceIndex).toHaveBeenCalled();
        expect(onNotify).toHaveBeenCalledWith("Playlist deleted", "good");
      });
      expect(
        onNotify.mock.calls.filter(([, tone]) => tone === "bad"),
      ).toEqual([]);
      expect(
        queryClient.getQueryData(playlistQueryKey(summary.id)),
      ).toBeUndefined();
      expect(
        screen.queryByRole("heading", { name: "Night drive" }),
      ).not.toBeInTheDocument();
      expect(unhandled.handler).not.toHaveBeenCalled();
      unhandled.stop();
    },
  );

  it("replaces a deleted playlist URL when the recovery commit also fails", async () => {
    const unhandled = trackUnhandledRejections();
    const user = userEvent.setup();
    const onNotify = vi.fn();
    const onBack = vi.fn().mockResolvedValue("failed");
    const onReplaceIndex = vi.fn().mockResolvedValue("failed");
    mocks.fetchPlaylist.mockRejectedValue(new Error("Playlist is gone"));
    const { queryClient, router } = renderPlaylistsController(
      <PlaylistsController
        onBack={onBack}
        onReplaceIndex={onReplaceIndex}
        playlistId={playlistId}
        screen="detail"
      />,
      {
        initialEntry: `/playlists/${playlistId}`,
        seed: (queryClient) => {
          seedPlaylists(queryClient);
          seedPlaylistDetail(queryClient);
        },
        runtime: { ...commonProps, onNotify },
      },
    );

    expect(router.state.location.pathname).toBe(`/playlists/${playlistId}`);

    await user.click(
      await screen.findByRole("button", { name: "Delete playlist" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Delete playlist from Bandcamp" }),
    );

    await waitFor(() => {
      expect(onReplaceIndex).toHaveBeenCalled();
      expect(router.state.location.pathname).toBe("/playlists");
    });
    expect(onNotify).toHaveBeenCalledWith("Playlist deleted", "good");
    expect(
      onNotify.mock.calls.filter(([, tone]) => tone === "bad"),
    ).toEqual([]);
    expect(
      queryClient.getQueryData(playlistQueryKey(summary.id)),
    ).toBeUndefined();
    expect(unhandled.handler).not.toHaveBeenCalled();
    unhandled.stop();
  });
});
