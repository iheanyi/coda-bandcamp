import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FavoriteCollection, PlaylistDetail, PlaylistSummary, Track } from "./types";

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

const favorites: FavoriteCollection = {
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
};

function withQueryClient(node: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
}

const commonProps = {
  connected: true,
  favorites,
  favoritesLoading: false,
  favoritesLocal: true,
  onRefreshFavorites: vi.fn(),
  onToggleFavorite: vi.fn(),
  onPlayTracks: vi.fn(),
  onQueueTracks: vi.fn(),
  onPlayTrack: vi.fn(),
  onQueueTrack: vi.fn(),
  onOpenAlbum: vi.fn(),
  onOpenTrackAlbum: vi.fn(),
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
  it("opens a synced playlist and exposes playback and editing actions", async () => {
    withQueryClient(<SavedLibraryView mode="playlists" {...commonProps} />);

    const createCopy = (await screen.findByText("Create a playlist")).parentElement;
    expect(createCopy).toHaveClass("playlist-create__copy");
    expect(within(createCopy!).getByText("New playlist")).toBeInTheDocument();
    expect(
      within(createCopy!).getByText("Playlists sync with your Bandcamp collection."),
    ).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: /Night drive/ }));
    expect(await screen.findByRole("heading", { name: "Night drive" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(commonProps.onPlayTracks).toHaveBeenCalledWith([track]);

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

  it("disables playlist creation and announces its pending state", async () => {
    let resolveCreate!: (playlist: PlaylistDetail) => void;
    mocks.createPlaylist.mockReturnValue(new Promise((resolve) => {
      resolveCreate = resolve;
    }));
    const onClose = vi.fn();
    withQueryClient(
      <AddToPlaylistDialog tracks={[track]} onClose={onClose} onNotify={vi.fn()} />,
    );

    fireEvent.change(screen.getByLabelText("New playlist name"), {
      target: { value: "Fresh finds" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByRole("button", { name: "Creating…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close add to playlist" })).toBeDisabled();

    resolveCreate(detail);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("renders favorites and removes a starred track through the supplied action", () => {
    withQueryClient(<SavedLibraryView mode="favorites" {...commonProps} />);

    const favoriteTracks = screen.getByLabelText("Favorite tracks");
    fireEvent.click(within(favoriteTracks).getByRole("button", { name: "Remove Mirage from favorites" }));
    expect(commonProps.onToggleFavorite).toHaveBeenCalledWith("song-1", "song", false);
    fireEvent.click(within(favoriteTracks).getByRole("button", {
      name: "Sweeps · Mirage",
    }));
    expect(commonProps.onOpenTrackAlbum).toHaveBeenCalledWith(track);
    expect(screen.getByText("Local")).toBeInTheDocument();
  });
});
