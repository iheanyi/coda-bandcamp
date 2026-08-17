import type { ToastNotifier } from "@/components/ui/toastManager";
import type { RouteCommitOutcome } from "@/features/navigation/routeCommit";
import type {
  PlaylistOpenRequest,
} from "@/features/saved-library/playlistRouteNavigation";
import type { PlaylistId } from "@/routing/routeContracts";
import type {
  Album,
  LocalFavoriteCollection,
  RadioShowSummary,
  Track,
} from "@/types";

export type FavoritesScreenProps = Readonly<{
  className?: string;
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

export type PlaylistsScreenProps = Readonly<{
  className?: string;
  connected: boolean;
  onOpenPlaylist: (request: PlaylistOpenRequest) => Promise<RouteCommitOutcome>;
  onNotify: ToastNotifier;
}>;

export type PlaylistDetailScreenProps = Readonly<{
  className?: string;
  connected: boolean;
  playlistId: PlaylistId;
  loadingAlbumId?: string;
  currentTrackId?: string;
  playing: boolean;
  onBack: () => Promise<RouteCommitOutcome>;
  onReplaceIndex: () => Promise<RouteCommitOutcome>;
  onTogglePlayback: () => void;
  onPlayTracks: (tracks: Track[]) => void;
  onQueueTracks: (tracks: Track[]) => void;
  onOpenTrackAlbum: (track: Track, trigger: HTMLElement) => void;
  onOpenArtist: (
    artist: string,
    albumId?: string,
    sourceTrack?: Track,
    sourceTrigger?: HTMLElement,
  ) => void;
  onAddToPlaylist: (tracks: Track[]) => void;
  onNotify: ToastNotifier;
}>;

type FavoritesControllerProps = FavoritesScreenProps &
  Readonly<{
    mode: "favorites";
  }>;

type PlaylistsIndexControllerProps = PlaylistsScreenProps &
  Readonly<{
    mode: "playlists";
    screen: "index";
  }>;

type PlaylistDetailControllerProps = PlaylistDetailScreenProps &
  Readonly<{
    mode: "playlists";
    screen: "detail";
  }>;

export type PlaylistsControllerProps =
  | PlaylistsIndexControllerProps
  | PlaylistDetailControllerProps;

export type SavedLibraryControllerProps =
  | FavoritesControllerProps
  | PlaylistsControllerProps;
