import { createContext, useContext } from "react";

import type { ToastNotifier } from "@/components/ui/toastManager";
import type {
  Album,
  LocalFavoriteCollection,
  RadioShowSummary,
  Track,
} from "@/types";

export type SavedLibraryRuntimeValue = Readonly<{
  connected: boolean;
  favorites?: LocalFavoriteCollection;
  favoritesLoading: boolean;
  favoritesError?: string;
  favoritesLocal?: boolean;
  loadingAlbumId?: string;
  onRefreshFavorites: () => void;
  onToggleFavorite: (
    id: string,
    kind: "song" | "album",
    favorite: boolean,
  ) => void;
  onToggleRadioFavorite: (show: RadioShowSummary, favorite: boolean) => void;
  currentTrackId?: string;
  playing: boolean;
  onTogglePlayback: () => void;
  onPlayTracks: (tracks: Track[]) => void;
  onQueueTracks: (tracks: Track[]) => void;
  onPlayTrack: (track: Track) => void;
  onQueueTrack: (track: Track) => void;
  onOpenAlbum: (album: Album, trigger: HTMLElement) => void;
  onOpenTrackAlbum: (track: Track, trigger: HTMLElement) => void;
  onOpenArtist: (
    artist: string,
    albumId?: string,
    sourceTrack?: Track,
    sourceTrigger?: HTMLElement,
  ) => void;
  onOpenRadioShow: (show: RadioShowSummary) => void;
  onOpenRadioSeries: (seriesId?: number) => void;
  onAddToPlaylist: (tracks: Track[]) => void;
  onNotify: ToastNotifier;
}>;

export const SavedLibraryRuntimeContext = createContext<
  SavedLibraryRuntimeValue | undefined
>(undefined);

export function useSavedLibraryRuntime(): SavedLibraryRuntimeValue {
  const runtime = useContext(SavedLibraryRuntimeContext);
  if (!runtime) {
    throw new Error("Saved routes require a Saved Library runtime provider");
  }
  return runtime;
}
