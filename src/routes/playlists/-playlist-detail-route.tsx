import { getRouteApi } from "@tanstack/react-router";

import { PlaylistDetailScreen } from "@/features/saved-library";
import { usePlaylistRouteNavigation } from "@/features/saved-library/playlistRouteNavigation";
import { useSavedLibraryRuntime } from "@/features/saved-library/SavedLibraryRuntimeContext";

const playlistDetailRouteApi = getRouteApi("/playlists/$playlistId");

export function PlaylistDetailRoute() {
  const runtime = useSavedLibraryRuntime();
  const { playlistId } = playlistDetailRouteApi.useParams();
  const navigation = usePlaylistRouteNavigation();

  return (
    <PlaylistDetailScreen
      connected={runtime.connected}
      currentTrackId={runtime.currentTrackId}
      loadingAlbumId={runtime.loadingAlbumId}
      onAddToPlaylist={runtime.onAddToPlaylist}
      onBack={() => navigation.closePlaylist(playlistId)}
      onNotify={runtime.onNotify}
      onOpenArtist={runtime.onOpenArtist}
      onOpenTrackAlbum={runtime.onOpenTrackAlbum}
      onPlayTracks={runtime.onPlayTracks}
      onQueueTracks={runtime.onQueueTracks}
      onReplaceIndex={navigation.replaceWithIndex}
      onTogglePlayback={runtime.onTogglePlayback}
      playing={runtime.playing}
      playlistId={playlistId}
    />
  );
}
