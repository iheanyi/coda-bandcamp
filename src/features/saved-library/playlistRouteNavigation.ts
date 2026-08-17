import { createContext, useContext } from "react";

import type {
  RouteCommitOutcome,
  RouteCommitResult,
} from "@/features/navigation/routeCommit";
import type { PlaylistId } from "@/routing/routeContracts";

export type PlaylistOpenRequest = Readonly<{
  playlistId: PlaylistId;
  sharedIdentityAvailable: boolean;
  sourceTrigger?: HTMLElement;
}>;

export type PlaylistRouteNavigationAdapter = Readonly<{
  goBack: () => Promise<RouteCommitResult>;
  goToIndex: (replace?: boolean) => Promise<RouteCommitResult>;
  goToPlaylist: (playlistId: PlaylistId) => Promise<RouteCommitResult>;
}>;

export type PlaylistRouteNavigationValue = Readonly<{
  closePlaylist: (playlistId: PlaylistId) => Promise<RouteCommitOutcome>;
  openPlaylist: (request: PlaylistOpenRequest) => Promise<RouteCommitOutcome>;
  replaceWithIndex: () => Promise<RouteCommitOutcome>;
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
