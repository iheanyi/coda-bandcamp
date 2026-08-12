import { createFileRoute } from "@tanstack/react-router";

import { PlaylistDetailScreen } from "@/SavedLibraryView";
import { usePlaylistRouteNavigation } from "@/features/saved-library/playlistRouteNavigation";
import { useSavedLibraryRuntime } from "@/features/saved-library/SavedLibraryRuntimeContext";
import {
  parsePlaylistIdParam,
  stringifyPlaylistIdParam,
} from "@/routing/routeContracts";
import { codaRouteMeta } from "@/routing/routeMeta";
import { PlaylistRoutePending } from "@/routes/-route-loading";

function PlaylistDetailRoute() {
  const runtime = useSavedLibraryRuntime();
  const { playlistId } = Route.useParams();
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
      onTogglePlayback={runtime.onTogglePlayback}
      playing={runtime.playing}
      playlistId={playlistId}
    />
  );
}

export const Route = createFileRoute("/playlists/$playlistId")({
  component: PlaylistDetailRoute,
  pendingComponent: PlaylistRoutePending,
  params: {
    parse: ({ playlistId }) => ({
      playlistId: parsePlaylistIdParam(playlistId),
    }),
    stringify: ({ playlistId }) => ({
      playlistId: stringifyPlaylistIdParam(playlistId),
    }),
  },
  staticData: codaRouteMeta("playlist", "playlists"),
});
