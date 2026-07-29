import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CodaMotionProvider } from "./MotionProvider";
import type {
  LocalFavoriteCollection,
  PlaylistDetail,
  PlaylistSummary,
  Track,
} from "./types";

const mocks = vi.hoisted(() => ({
  createPlaylist: vi.fn(),
  deletePlaylist: vi.fn(),
  fetchPlaylist: vi.fn(),
  fetchPlaylists: vi.fn(),
  updatePlaylist: vi.fn(),
}));

vi.mock("./lib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib")>();
  return {
    ...actual,
    createPlaylist: mocks.createPlaylist,
    deletePlaylist: mocks.deletePlaylist,
    fetchPlaylist: mocks.fetchPlaylist,
    fetchPlaylists: mocks.fetchPlaylists,
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

const favorites: LocalFavoriteCollection = {
  albumIds: ["album-1"],
  songIds: ["song-1"],
  albums: [{
    id: "album-1",
    title: "Mirage",
    artist: "Sweeps",
    songCount: 1,
    duration: 188,
    palette: ["#a66", "#222"],
  }],
  tracks: [track],
  radioShowIds: [979],
  radioShows: [{
    id: 979,
    subtitle: "The Hip Hop Show",
    description: "New independent hip-hop.",
    publishedAt: "24 Jul 2026 00:00:00 GMT",
    series: {
      id: 5,
      title: "The Hip Hop Show",
      slug: "the-hip-hop-show",
    },
  }],
};

function withQueryClient(node: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return {
    ...render(
      <CodaMotionProvider>
        <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>
      </CodaMotionProvider>,
    ),
    queryClient,
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
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.fetchPlaylists.mockResolvedValue([summary]);
  mocks.fetchPlaylist.mockResolvedValue(detail);
  mocks.createPlaylist.mockResolvedValue(detail);
  mocks.updatePlaylist.mockResolvedValue(detail);
  mocks.deletePlaylist.mockResolvedValue(undefined);
  Object.values(commonProps).forEach((value) => {
    if (typeof value === "function" && "mockClear" in value) value.mockClear();
  });
});

describe("saved Bandcamp library views", () => {
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

      const playlistButton = await screen.findByRole("button", {
        name: /Night drive/,
      });
      fireEvent.click(playlistButton);

      expect(startViewTransition).not.toHaveBeenCalled();
      expect(screen.getByText("Loading playlist")).toBeInTheDocument();
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

  it("opens a synced playlist and exposes playback and editing actions", async () => {
    withQueryClient(<SavedLibraryView mode="playlists" {...commonProps} />);

    expect(await screen.findByText("Create a playlist")).toBeInTheDocument();
    expect(screen.getByText("New playlist")).toBeInTheDocument();
    expect(
      screen.getByText("Playlists sync with your Bandcamp collection."),
    ).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: /Night drive/ }));
    expect(await screen.findByRole("heading", { name: "Night drive" }))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(commonProps.onPlayTracks).toHaveBeenCalledWith([track]);
    const playlistTracks = screen.getByLabelText("Night drive tracks");
    fireEvent.click(within(playlistTracks).getByRole("button", { name: "Sweeps" }));
    expect(commonProps.onOpenArtist).toHaveBeenCalledWith(
      "Sweeps",
      "album-1",
      track,
    );
    const playlistAlbumButton = within(playlistTracks).getByRole("button", {
      name: "Open Mirage album",
    });
    fireEvent.click(playlistAlbumButton);
    expect(commonProps.onOpenTrackAlbum).toHaveBeenCalledWith(
      track,
      playlistAlbumButton,
    );

    fireEvent.click(screen.getByRole("button", { name: "Rename Night drive" }));
    fireEvent.change(screen.getByLabelText("Playlist name"), { target: { value: "After hours" } });
    fireEvent.click(screen.getByRole("button", { name: "Save playlist name" }));
    await waitFor(() =>
      expect(mocks.updatePlaylist.mock.calls[0]?.[0]).toEqual({
        playlistId: "playlist-1",
        name: "After hours",
      }),
    );
  });

  it("moves focus into playlist details and restores the opening row on Back", async () => {
    withQueryClient(<SavedLibraryView mode="playlists" {...commonProps} />);

    const playlistButton = await screen.findByRole("button", {
      name: /Night drive/,
    });
    playlistButton.focus();
    fireEvent.click(playlistButton);

    const heading = await screen.findByRole("heading", {
      name: "Night drive",
    });
    await waitFor(() => expect(heading).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "All playlists" }));

    const restoredPlaylistButton = await screen.findByRole("button", {
      name: /Night drive/,
    });
    await waitFor(() => expect(restoredPlaylistButton).toHaveFocus());
  });

  it("creates a playlist with selected tracks from the add dialog", async () => {
    const onClose = vi.fn();
    const onNotify = vi.fn();
    withQueryClient(
      <AddToPlaylistDialog tracks={[track]} onClose={onClose} onNotify={onNotify} />,
    );

    fireEvent.change(screen.getByLabelText("New playlist name"), {
      target: { value: "Fresh finds" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(mocks.createPlaylist).toHaveBeenCalledWith("Fresh finds", ["song-1"]),
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
      expect(screen.queryByRole("dialog", { name: "Add to playlist" }))
        .not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    fireEvent.pointerDown(document.body);
    fireEvent.mouseDown(document.body);
    fireEvent.click(document.body);
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Add to playlist" }))
        .not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });

  it("rejects Escape and backdrop dismissal while an add mutation is pending", async () => {
    const user = userEvent.setup();
    const pendingCreate = deferred<PlaylistDetail>();
    mocks.createPlaylist.mockReturnValue(pendingCreate.promise);
    withQueryClient(<AddDialogHarness />);

    await user.click(screen.getByRole("button", {
      name: "Add selected to playlist",
    }));
    await user.type(screen.getByLabelText("New playlist name"), "Fresh finds");
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByRole("button", { name: "Creating…" }))
      .toBeDisabled();

    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Add to playlist" }))
      .toBeVisible();
    fireEvent.pointerDown(document.body);
    fireEvent.mouseDown(document.body);
    fireEvent.click(document.body);
    expect(screen.getByRole("dialog", { name: "Add to playlist" }))
      .toBeVisible();
    expect(mocks.createPlaylist).toHaveBeenCalledTimes(1);

    pendingCreate.resolve(detail);
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Add to playlist" }))
        .not.toBeInTheDocument(),
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

    expect(await screen.findByRole("button", { name: /Fresh finds/ }))
      .toBeInTheDocument();
    pendingCreate.reject(new Error("Create failed"));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Fresh finds/ }))
        .not.toBeInTheDocument(),
    );
    expect(commonProps.onNotify).toHaveBeenCalledWith("Create failed", "bad");
  });

  it("optimistically renames a playlist and restores its name on failure", async () => {
    const pendingUpdate = deferred<PlaylistDetail>();
    mocks.updatePlaylist.mockReturnValue(pendingUpdate.promise);
    withQueryClient(<SavedLibraryView mode="playlists" {...commonProps} />);

    fireEvent.click(await screen.findByRole("button", { name: /Night drive/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Rename Night drive" }));
    fireEvent.change(screen.getByLabelText("Playlist name"), {
      target: { value: "After hours" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save playlist name" }));

    expect(await screen.findByRole("heading", { name: "After hours" }))
      .toBeInTheDocument();
    pendingUpdate.reject(new Error("Rename failed"));

    expect(await screen.findByRole("heading", { name: "Night drive" }))
      .toBeInTheDocument();
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

    fireEvent.click(await screen.findByRole("button", { name: /Night drive/ }));
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

    fireEvent.click(await screen.findByRole("button", { name: /Night drive/ }));
    fireEvent.click(await screen.findByRole("button", {
      name: "Remove Lanterns from Night drive",
    }));

    await waitFor(() =>
      expect(screen.queryByText("Lanterns")).not.toBeInTheDocument()
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

    await user.click(await screen.findByRole("button", { name: /Night drive/ }));
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
    await user.click(screen.getByRole("button", {
      name: "Delete playlist from Bandcamp",
    }));
    expect(mocks.deletePlaylist).toHaveBeenCalledTimes(1);
    expect(mocks.deletePlaylist.mock.calls[0]?.[0]).toBe("playlist-1");

    await waitFor(() =>
      expect(queryClient.getQueryData<PlaylistSummary[]>(["bandcamp", "playlists"]))
        .toEqual([]),
    );
    expect(screen.getByRole("alertdialog", {
      name: "Delete Night drive?",
    })).toBeVisible();
    expect(screen.getByRole("button", {
      name: "Delete playlist from Bandcamp",
    })).toBeDisabled();
    expect(screen.getByText("Deleting…")).toBeInTheDocument();
    pendingDelete.reject(new Error("Delete failed"));

    await waitFor(() =>
      expect(queryClient.getQueryData<PlaylistSummary[]>(["bandcamp", "playlists"]))
        .toEqual([summary]),
    );
    expect(screen.getByRole("alertdialog", {
      name: "Delete Night drive?",
    })).toBeVisible();
    expect(screen.getByRole("button", {
      name: "Delete playlist from Bandcamp",
    })).toBeEnabled();
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
    ).toEqual([{
      ...summary,
      duration: summary.duration + secondTrack.duration,
      songCount: 2,
    }]);
    expect(onNotify).toHaveBeenCalledWith(
      "1 track added to Night drive",
      "good",
    );
  });

  it("renders favorites and removes a starred track through the supplied action", () => {
    withQueryClient(<SavedLibraryView mode="favorites" {...commonProps} />);

    const favoriteTracks = screen.getByLabelText("Favorite tracks");
    fireEvent.click(within(favoriteTracks).getByRole("button", { name: "Remove Mirage from favorites" }));
    expect(commonProps.onToggleFavorite).toHaveBeenCalledWith("song-1", "song", false);
    fireEvent.click(within(favoriteTracks).getByRole("button", { name: "Sweeps" }));
    expect(commonProps.onOpenArtist).toHaveBeenCalledWith(
      "Sweeps",
      "album-1",
      track,
    );
    const favoriteAlbumButton = within(favoriteTracks).getByRole("button", {
      name: "Open Mirage album",
    });
    fireEvent.click(favoriteAlbumButton);
    expect(commonProps.onOpenTrackAlbum).toHaveBeenCalledWith(
      track,
      favoriteAlbumButton,
    );
    fireEvent.click(screen.getByRole("button", {
      name: "Browse The Hip Hop Show",
    }));
    expect(commonProps.onOpenRadioSeries).toHaveBeenCalledWith(5);
    fireEvent.click(screen.getByRole("button", {
      name: "Open The Hip Hop Show details",
    }));
    expect(commonProps.onOpenRadioShow).toHaveBeenCalledWith(
      favorites.radioShows[0],
    );
    fireEvent.click(screen.getByRole("button", {
      name: "Remove The Hip Hop Show from favorites",
    }));
    expect(commonProps.onToggleRadioFavorite).toHaveBeenCalledWith(
      favorites.radioShows[0],
      false,
    );
  });

  it("marks every saved-library album destination busy while its album opens", async () => {
    const favoriteView = withQueryClient(
      <SavedLibraryView
        mode="favorites"
        {...commonProps}
        loadingAlbumId="album-1"
      />,
    );

    const releases = screen.getByRole("heading", { name: "Releases" })
      .closest("section");
    if (!releases) throw new Error("Expected a releases section");
    const artworkButton = within(releases).getByRole("button", {
      name: "Open Mirage",
    });
    const titleButton = within(releases).getByRole("button", {
      name: "Mirage",
    });

    expect(artworkButton).toBeDisabled();
    expect(artworkButton).toHaveAttribute("aria-busy", "true");
    expect(within(artworkButton).getByRole("status", {
      name: "Loading Mirage artwork",
    })).toBeInTheDocument();
    expect(titleButton).toBeDisabled();
    expect(titleButton).toHaveAttribute("aria-busy", "true");
    expect(within(titleButton).getByRole("status", {
      name: "Loading Mirage release",
    })).toBeInTheDocument();

    const favoriteTracks = screen.getByLabelText("Favorite tracks");
    const favoriteAlbumButton = within(favoriteTracks).getByRole("button", {
      name: "Open Mirage album",
    });

    expect(favoriteAlbumButton).toBeDisabled();
    expect(favoriteAlbumButton).toHaveAttribute("aria-busy", "true");
    expect(within(favoriteAlbumButton).getByRole("status", {
      name: "Loading Mirage album",
    })).toBeInTheDocument();
    favoriteView.unmount();

    withQueryClient(
      <SavedLibraryView
        mode="playlists"
        {...commonProps}
        loadingAlbumId="album-1"
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Night drive/ }));
    const playlistTracks = await screen.findByLabelText("Night drive tracks");
    const playlistAlbumButton = within(playlistTracks).getByRole("button", {
      name: "Open Mirage album",
    });

    expect(playlistAlbumButton).toBeDisabled();
    expect(playlistAlbumButton).toHaveAttribute("aria-busy", "true");
    expect(within(playlistAlbumButton).getByRole("status", {
      name: "Loading Mirage album",
    })).toBeInTheDocument();
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

    fireEvent.click(await screen.findByRole("button", { name: /Night drive/ }));
    expect(await screen.findByRole("button", { name: "Pause Night drive" }))
      .toHaveAttribute("aria-pressed", "true");
    const trackPause = screen.getByRole("button", { name: "Pause Mirage" });
    expect(trackPause).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(trackPause);
    expect(onTogglePlayback).toHaveBeenCalledOnce();
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
        this.callback([{
          borderBoxSize: [{
            blockSize: bounds.height,
            inlineSize: bounds.width,
          }],
          contentRect: bounds,
          target,
        } as unknown as ResizeObserverEntry], this);
      }
      unobserve() {}
    }
    globalThis.ResizeObserver = ResizeObserverMock;
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
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
});
