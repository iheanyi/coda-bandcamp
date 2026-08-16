import type { ComponentType } from "react";
import { useLayoutEffect } from "react";

import {
  PlaylistsScreen as DefaultPlaylistsScreen,
  type PlaylistsScreenProps,
} from "@/SavedLibraryView";
import { usePlaylistRouteNavigation } from "@/features/saved-library/playlistRouteNavigation";
import { useSavedLibraryRuntime } from "@/features/saved-library/SavedLibraryRuntimeContext";

export function PlaylistsIndexRoute({
  Screen = DefaultPlaylistsScreen,
}: Readonly<{
  Screen?: ComponentType<PlaylistsScreenProps>;
}> = {}) {
  const runtime = useSavedLibraryRuntime();
  const navigation = usePlaylistRouteNavigation();

  useLayoutEffect(() => {
    navigation.restoreListContext();
  }, [navigation.restoreListContext]);

  return (
    <Screen
      connected={runtime.connected}
      onNotify={runtime.onNotify}
      onOpenPlaylist={navigation.openPlaylist}
    />
  );
}
