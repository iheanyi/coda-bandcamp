import { useMemo } from "react";

import type { ToastNotifier } from "@/components/ui/toastManager";
import type { LocalFavoritesController } from "@/features/favorites/useLocalFavoritesController";
import type { Album, RadioShowSummary, Track } from "@/types";

import type { SavedLibraryRuntimeValue } from "./SavedLibraryRuntimeContext";

export type SavedLibraryPlaybackRuntime = Pick<
  SavedLibraryRuntimeValue,
  | "currentTrackId"
  | "onPlayTrack"
  | "onPlayTracks"
  | "onQueueTrack"
  | "onQueueTracks"
  | "onTogglePlayback"
  | "playing"
>;

export type SavedLibraryNavigationRuntime = Readonly<{
  onOpenAlbum: (album: Album, trigger: HTMLElement) => void | Promise<void>;
  onOpenArtist: SavedLibraryRuntimeValue["onOpenArtist"];
  onOpenRadioSeries: SavedLibraryRuntimeValue["onOpenRadioSeries"];
  onOpenRadioShow: SavedLibraryRuntimeValue["onOpenRadioShow"];
  onOpenTrackAlbum: SavedLibraryRuntimeValue["onOpenTrackAlbum"];
}>;

type SavedLibraryFavoritesRuntime = Pick<
  LocalFavoritesController,
  "collection" | "ready" | "refresh" | "toggleFavorite" | "toggleRadioFavorite"
>;

export type SavedLibraryRuntimeAdapterOptions = Readonly<{
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
  const { collection, ready, refresh, toggleFavorite, toggleRadioFavorite } =
    favorites;
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
      favoritesLoading: !ready,
      favoritesLocal: true,
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
      onToggleRadioFavorite: (show: RadioShowSummary, favorite: boolean) =>
        toggleRadioFavorite(show, favorite),
      playing,
    }),
    [
      collection,
      connected,
      currentTrackId,
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
