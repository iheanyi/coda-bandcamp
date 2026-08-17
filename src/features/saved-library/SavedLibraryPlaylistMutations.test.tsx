import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { PlaylistDetail, PlaylistSummary } from "@/types";
import {
  commonProps,
  deferred,
  detail,
  mockVirtualizedViewport,
  mocks,
  secondTrack,
  renderSavedLibraryRoute,
  summary,
  track,
} from "@/test/savedLibraryViewTestHarness";

describe("saved playlist synchronization", () => {
  it("shows a newly created playlist immediately and removes it on failure", async () => {
    const pendingCreate = deferred<PlaylistDetail>();
    mocks.createPlaylist.mockReturnValue(pendingCreate.promise);
    renderSavedLibraryRoute({ initialEntry: "/playlists" });

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
    renderSavedLibraryRoute({ initialEntry: "/playlists" });

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
    renderSavedLibraryRoute({ initialEntry: "/playlists" });

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
    renderSavedLibraryRoute({ initialEntry: "/playlists" });

    fireEvent.click(await screen.findByRole("link", { name: /Night drive/ }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Remove Lanterns from Night drive",
      }),
    );

    await waitFor(() =>
      expect(screen.queryByText("Lanterns")).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(mocks.fetchPlaylist.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
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
    const { queryClient } = renderSavedLibraryRoute({
      initialEntry: "/playlists",
    });

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

  it(
    "keeps 5,000 playlist cards bounded while preserving optimistic create and open",
    async () => {
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
        renderSavedLibraryRoute({ initialEntry: "/playlists" });

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
        expect(await screen.findByText("Opening playlist…")).toBeInTheDocument();
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
    },
    15_000,
  );
});
