import { renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import type { Album, LocalFavoriteCollection } from "@/types";

import { useSavedLibraryRuntimeAdapter } from "./useSavedLibraryRuntimeAdapter";

const favorites: LocalFavoriteCollection = {
  albumIds: [],
  songIds: [],
  albums: [],
  tracks: [],
  radioShowIds: [],
  radioShows: [],
};

const album: Album = {
  id: "album-1",
  title: "Blue Hours",
  artist: "Signal Garden",
  songCount: 1,
  duration: 201,
  palette: ["#777", "#222"],
};

it("adapts the Favorites controller and discards async navigation results", () => {
  const onOpenAlbum = vi.fn(async () => undefined);
  const refresh = vi.fn();
  const toggleFavorite = vi.fn();
  const toggleRadioFavorite = vi.fn();
  const onNotify = vi.fn();
  const { result } = renderHook(() =>
    useSavedLibraryRuntimeAdapter({
      connected: true,
      favorites: {
        collection: favorites,
        ready: false,
        refresh,
        toggleFavorite,
        toggleRadioFavorite,
      },
      loadingAlbumId: album.id,
      navigation: {
        onOpenAlbum,
        onOpenArtist: vi.fn(),
        onOpenRadioSeries: vi.fn(),
        onOpenRadioShow: vi.fn(),
        onOpenTrackAlbum: vi.fn(),
      },
      onAddToPlaylist: vi.fn(),
      notify: onNotify,
      playback: {
        currentTrackId: "track-1",
        onPlayTrack: vi.fn(),
        onPlayTracks: vi.fn(),
        onQueueTrack: vi.fn(),
        onQueueTracks: vi.fn(),
        onTogglePlayback: vi.fn(),
        playing: true,
      },
    }),
  );

  expect(result.current).toMatchObject({
    connected: true,
    currentTrackId: "track-1",
    favorites,
    favoritesLoading: true,
    favoritesLocal: true,
    loadingAlbumId: album.id,
    onNotify,
    playing: true,
  });
  expect(result.current.onOpenAlbum(album, document.createElement("a"))).toBe(
    undefined,
  );
  expect(onOpenAlbum).toHaveBeenCalledWith(
    album,
    expect.any(HTMLAnchorElement),
  );
  expect(result.current.onRefreshFavorites).toBe(refresh);
  expect(result.current.onToggleFavorite).toBe(toggleFavorite);
});
