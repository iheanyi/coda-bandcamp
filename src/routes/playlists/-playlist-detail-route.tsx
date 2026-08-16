import { getRouteApi } from "@tanstack/react-router";
import type { ComponentType } from "react";

import {
  PlaylistDetailScreen as DefaultPlaylistDetailScreen,
  type PlaylistDetailScreenProps,
} from "@/SavedLibraryView";
import { usePlaylistRouteNavigation } from "@/features/saved-library/playlistRouteNavigation";
import { useSavedLibraryRuntime } from "@/features/saved-library/SavedLibraryRuntimeContext";

const playlistDetailRouteApi = getRouteApi("/playlists/$playlistId");

export function PlaylistDetailRoute({
  Screen = DefaultPlaylistDetailScreen,
}: Readonly<{
  Screen?: ComponentType<PlaylistDetailScreenProps>;
}> = {}) {
  const runtime = useSavedLibraryRuntime();
  const { playlistId } = playlistDetailRouteApi.useParams();
  const navigation = usePlaylistRouteNavigation();

  return (
    <Screen
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
      onTogglePlayback={runtime.onTogglePlayback}
      playing={runtime.playing}
      playlistId={playlistId}
    />
  );
}
