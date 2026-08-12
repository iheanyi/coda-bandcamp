import { createFileRoute } from "@tanstack/react-router";
import { useLayoutEffect } from "react";

import { PlaylistsScreen } from "@/SavedLibraryView";
import { usePlaylistRouteNavigation } from "@/features/saved-library/playlistRouteNavigation";
import { useSavedLibraryRuntime } from "@/features/saved-library/SavedLibraryRuntimeContext";
import { codaRouteMeta } from "@/routing/routeMeta";
import { PlaylistsRoutePending } from "@/routes/-route-loading";

function PlaylistsIndexRoute() {
  const runtime = useSavedLibraryRuntime();
  const navigation = usePlaylistRouteNavigation();

  useLayoutEffect(() => {
    navigation.restoreListContext();
  }, [navigation.restoreListContext]);

  return (
    <PlaylistsScreen
      connected={runtime.connected}
      onNotify={runtime.onNotify}
      onOpenPlaylist={navigation.openPlaylist}
    />
  );
}

export const Route = createFileRoute("/playlists/")({
  component: PlaylistsIndexRoute,
  pendingComponent: PlaylistsRoutePending,
  staticData: codaRouteMeta("playlists", "playlists"),
});
