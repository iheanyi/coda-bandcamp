import { useLayoutEffect } from "react";

import { PlaylistsScreen } from "@/features/saved-library";
import { usePlaylistRouteNavigation } from "@/features/saved-library/playlistRouteNavigation";
import { useSavedLibraryRuntime } from "@/features/saved-library/SavedLibraryRuntimeContext";

export function PlaylistsIndexRoute() {
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
