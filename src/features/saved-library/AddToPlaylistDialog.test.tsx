import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { PlaylistDetail, PlaylistSummary } from "@/types";
import {
  AddDialogHarness,
  deferred,
  detail,
  mockVirtualizedViewport,
  mocks,
  PersistentAddDialogHarness,
  secondTrack,
  summary,
  track,
  withQueryClient,
} from "@/test/savedLibraryViewTestHarness";
import { AddToPlaylistDialog } from "./AddToPlaylistDialog";

describe("Add to playlist dialog", () => {
  it("finds playlists by name, recovers from no matches, and adds to the filtered target", async () => {
    const user = userEvent.setup();
    const otherPlaylist = { ...summary, id: "morning", name: "Morning coffee" };
    mocks.fetchPlaylists.mockResolvedValueOnce([summary, otherPlaylist]);
    withQueryClient(
      <AddToPlaylistDialog
        tracks={[track]}
        onClose={vi.fn()}
        onNotify={vi.fn()}
      />,
    );

    const search = await screen.findByRole("textbox", {
      name: "Find a playlist",
    });
    await user.type(search, "missing");
    expect(
      screen.getByText("No matching playlists. Try a different name."),
    ).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("0 playlists found");
    expect(
      screen.queryByRole("button", { name: /Night drive/ }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Clear playlist search" }),
    );
    expect(search).toHaveFocus();
    expect(screen.getByRole("button", { name: /Night drive/ })).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Morning coffee/ }),
    ).toBeVisible();

    await user.type(search, "  COFFEE  ");
    expect(screen.getByRole("status")).toHaveTextContent("1 playlist found");
    expect(
      screen.queryByRole("button", { name: /Night drive/ }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Morning coffee/ }));
    await waitFor(() =>
      expect(mocks.updatePlaylist).toHaveBeenCalledWith({
        playlistId: "morning",
        songIdsToAdd: [track.id],
        songIndexesToRemove: [],
      }),
    );
    expect(mocks.fetchPlaylists).toHaveBeenCalledTimes(1);
  });

  it("creates a playlist with selected tracks", async () => {
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

  it("optimistically updates counts and rolls back on failure", async () => {
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

  it("closes with optimistic counts after a committed empty response", async () => {
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

  it("keeps 5,000 rows bounded with a focused pending add", async () => {
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

      const scroller = list.parentElement;
      if (!scroller) throw new Error("Playlist scroller is missing");
      scroller.scrollTop = 5_000;
      fireEvent.scroll(scroller);
      await waitFor(() =>
        expect(
          within(list).queryByRole("button", {
            name: /^Dialog playlist 0\s*0 tracks$/,
          }),
        ).not.toBeInTheDocument(),
      );
      fireEvent.change(screen.getByLabelText("Find a playlist"), {
        target: { value: "playlist 4999" },
      });
      expect(scroller.scrollTop).toBe(0);
      // jsdom does not emit the browser's scroll event when scrollTop changes.
      fireEvent.scroll(scroller);
      expect(within(list).getAllByRole("listitem")).toHaveLength(1);
      await waitFor(() =>
        expect(
          within(list).getByRole("button", { name: /Dialog playlist 4999/ }),
        ).toBeVisible(),
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Clear playlist search" }),
      );
      expect(scroller.scrollTop).toBe(0);
      fireEvent.scroll(scroller);
      await waitFor(() => {
        const rows = within(list).getAllByRole("listitem");
        expect(rows.length).toBeLessThan(40);
        expect(rows[0]).toHaveTextContent("Dialog playlist 0");
      });

      const target = await within(list).findByRole("button", {
        name: /^Dialog playlist 0\s*0 tracks$/,
      });
      act(() => target.focus());
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
        songIndexesToRemove: [],
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
