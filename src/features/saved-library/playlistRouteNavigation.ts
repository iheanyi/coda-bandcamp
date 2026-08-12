import { createContext, useContext } from "react";

import type { PlaylistId } from "@/routing/routeContracts";

export type PlaylistRouteNavigationAdapter = Readonly<{
  goBack: () => Promise<void>;
  goToIndex: (replace?: boolean) => Promise<void>;
  goToPlaylist: (playlistId: PlaylistId) => Promise<void>;
}>;

export type PlaylistRouteNavigationValue = Readonly<{
  closePlaylist: (playlistId: PlaylistId) => Promise<void>;
  openPlaylist: (playlistId: PlaylistId) => Promise<void>;
  restoreListContext: () => void;
}>;

export const PlaylistRouteNavigationContext = createContext<
  PlaylistRouteNavigationValue | undefined
>(undefined);

export function usePlaylistRouteNavigation(): PlaylistRouteNavigationValue {
  const navigation = useContext(PlaylistRouteNavigationContext);
  if (!navigation) {
    throw new Error(
      "Playlist screens require a Playlist route navigation provider",
    );
  }
  return navigation;
}
