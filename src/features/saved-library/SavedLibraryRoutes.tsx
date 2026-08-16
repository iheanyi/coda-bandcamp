import { SavedLibraryController } from "./SavedLibraryController";
import type {
  FavoritesScreenProps,
  PlaylistDetailScreenProps,
  PlaylistsScreenProps,
} from "./savedLibraryTypes";

export function FavoritesScreen({ className, ...props }: FavoritesScreenProps) {
  return (
    <SavedLibraryController
      {...props}
      className={className}
      mode="favorites"
    />
  );
}

export function PlaylistsScreen({
  className,
  connected,
  onOpenPlaylist,
  onNotify,
}: PlaylistsScreenProps) {
  return (
    <SavedLibraryController
      className={className}
      connected={connected}
      mode="playlists"
      onNotify={onNotify}
      onOpenPlaylist={onOpenPlaylist}
      screen="index"
    />
  );
}

export function PlaylistDetailScreen({
  className,
  connected,
  playlistId,
  loadingAlbumId,
  currentTrackId,
  playing,
  onBack,
  onTogglePlayback,
  onPlayTracks,
  onQueueTracks,
  onOpenTrackAlbum,
  onOpenArtist,
  onAddToPlaylist,
  onNotify,
  onReplaceIndex,
}: PlaylistDetailScreenProps) {
  return (
    <SavedLibraryController
      className={className}
      connected={connected}
      currentTrackId={currentTrackId}
      loadingAlbumId={loadingAlbumId}
      mode="playlists"
      onAddToPlaylist={onAddToPlaylist}
      onBack={onBack}
      onNotify={onNotify}
      onOpenArtist={onOpenArtist}
      onOpenTrackAlbum={onOpenTrackAlbum}
      onPlayTracks={onPlayTracks}
      onQueueTracks={onQueueTracks}
      onReplaceIndex={onReplaceIndex}
      onTogglePlayback={onTogglePlayback}
      playing={playing}
      playlistId={playlistId}
      screen="detail"
    />
  );
}
