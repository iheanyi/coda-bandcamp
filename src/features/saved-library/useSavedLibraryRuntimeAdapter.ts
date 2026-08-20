import { useMemo } from "react";

import type { ToastNotifier } from "@/components/ui/toastManager";
import type { FavoritesController } from "@/features/favorites/useLocalFavoritesController";
import type { Album, Track } from "@/types";

import type { SavedLibraryRuntimeValue } from "./SavedLibraryRuntimeContext";

type SavedLibraryPlaybackRuntime = Pick<
  SavedLibraryRuntimeValue,
  | "currentTrackId"
  | "onPlayTrack"
  | "onPlayTracks"
  | "onQueueTrack"
  | "onQueueTracks"
  | "onTogglePlayback"
  | "playing"
>;

type SavedLibraryNavigationRuntime = Readonly<{
  onOpenAlbum: (album: Album, trigger: HTMLElement) => void | Promise<void>;
  onOpenArtist: SavedLibraryRuntimeValue["onOpenArtist"];
  onOpenRadioSeries: SavedLibraryRuntimeValue["onOpenRadioSeries"];
  onOpenRadioShow: SavedLibraryRuntimeValue["onOpenRadioShow"];
  onOpenTrackAlbum: SavedLibraryRuntimeValue["onOpenTrackAlbum"];
}>;

type SavedLibraryFavoritesRuntime = Pick<
  FavoritesController,
  | "collection"
  | "loadError"
  | "ready"
  | "refresh"
  | "toggleFavorite"
  | "toggleRadioFavorite"
>;

type SavedLibraryRuntimeAdapterOptions = Readonly<{
  connected: boolean;
  favorites: SavedLibraryFavoritesRuntime;
  loadingAlbumId?: string;
  navigation: SavedLibraryNavigationRuntime;
  onAddToPlaylist: (tracks: Track[]) => void;
  notify: ToastNotifier;
  playback: SavedLibraryPlaybackRuntime;
}>;

/** Adapts focused shell controllers to the Saved Library route interface. */
export function useSavedLibraryRuntimeAdapter({
  connected,
  favorites,
  loadingAlbumId,
  navigation,
  onAddToPlaylist,
  notify,
  playback,
}: SavedLibraryRuntimeAdapterOptions): SavedLibraryRuntimeValue {
  const {
    collection,
    loadError,
    ready,
    refresh,
    toggleFavorite,
    toggleRadioFavorite,
  } = favorites;
  const {
    onOpenAlbum,
    onOpenArtist,
    onOpenRadioSeries,
    onOpenRadioShow,
    onOpenTrackAlbum,
  } = navigation;
  const {
    currentTrackId,
    onPlayTrack,
    onPlayTracks,
    onQueueTrack,
    onQueueTracks,
    onTogglePlayback,
    playing,
  } = playback;

  return useMemo(
    () => ({
      connected,
      currentTrackId,
      favorites: collection,
      favoritesError: loadError,
      favoritesLoading: !ready,
      favoritesLocal: false,
      loadingAlbumId,
      onAddToPlaylist,
      onNotify: notify,
      onOpenAlbum: (album, trigger) => {
        void onOpenAlbum(album, trigger);
      },
      onOpenArtist,
      onOpenRadioSeries,
      onOpenRadioShow,
      onOpenTrackAlbum,
      onPlayTrack,
      onPlayTracks,
      onQueueTrack,
      onQueueTracks,
      onRefreshFavorites: refresh,
      onToggleFavorite: toggleFavorite,
      onTogglePlayback,
      onToggleRadioFavorite: toggleRadioFavorite,
      playing,
    }),
    [
      collection,
      connected,
      currentTrackId,
      loadError,
      loadingAlbumId,
      notify,
      onAddToPlaylist,
      onOpenAlbum,
      onOpenArtist,
      onOpenRadioSeries,
      onOpenRadioShow,
      onOpenTrackAlbum,
      onPlayTrack,
      onPlayTracks,
      onQueueTrack,
      onQueueTracks,
      onTogglePlayback,
      playing,
      ready,
      refresh,
      toggleFavorite,
      toggleRadioFavorite,
    ],
  );
}
