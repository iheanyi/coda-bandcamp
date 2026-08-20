import { useLayoutEffect } from "react";

import { PlaylistsController } from "@/features/saved-library";
import { usePlaylistRouteNavigation } from "@/features/saved-library/playlistRouteNavigation";

export function PlaylistsIndexRoute() {
  const navigation = usePlaylistRouteNavigation();

  useLayoutEffect(() => {
    navigation.restoreListContext();
  }, [navigation.restoreListContext]);

  return (
    <PlaylistsController
      onOpenPlaylist={navigation.openPlaylist}
      screen="index"
    />
  );
}
