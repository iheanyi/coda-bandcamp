import { getRouteApi } from "@tanstack/react-router";

import { PlaylistsController } from "@/features/saved-library";
import { usePlaylistRouteNavigation } from "@/features/saved-library/playlistRouteNavigation";

const playlistDetailRouteApi = getRouteApi("/playlists/$playlistId");

export function PlaylistDetailRoute() {
  const { playlistId } = playlistDetailRouteApi.useParams();
  const navigation = usePlaylistRouteNavigation();

  return (
    <PlaylistsController
      onBack={() => navigation.closePlaylist(playlistId)}
      onReplaceIndex={navigation.replaceWithIndex}
      playlistId={playlistId}
      screen="detail"
    />
  );
}
