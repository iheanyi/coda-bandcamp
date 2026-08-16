import { type ReactNode, useCallback, useMemo } from "react";

import { restoreDetailScroll } from "@/detailNavigation";
import {
  closeIdentifiedDetail,
  openIdentifiedDetail,
  type IdentifiedDetailOpenRequest,
} from "@/features/navigation/detailRouteNavigation";
import type { PlaylistId } from "@/routing/routeContracts";

import {
  PlaylistRouteNavigationContext,
  type PlaylistRouteNavigationAdapter,
  type PlaylistRouteNavigationValue,
  type PlaylistOpenRequest,
} from "./playlistRouteNavigation";

export function PlaylistRouteNavigationProvider({
  adapter,
  children,
}: Readonly<{
  adapter: PlaylistRouteNavigationAdapter;
  children: ReactNode;
}>) {
  const openPlaylist = useCallback(
    (request: PlaylistOpenRequest) => {
      const { playlistId } = request;
      const openRequest: IdentifiedDetailOpenRequest = request.sourceTrigger
        ? {
            resetScrollOnOpen: true,
            sharedIdentityAvailable: request.sharedIdentityAvailable,
            sourceTrigger: request.sourceTrigger,
          }
        : {
            resetScrollOnOpen: true,
            sharedIdentityAvailable: request.sharedIdentityAvailable,
          };
      return openIdentifiedDetail(
        "playlist",
        playlistId,
        openRequest,
        () => adapter.goToPlaylist(playlistId),
      );
    },
    [adapter],
  );

  const restoreListContext = useCallback(() => restoreDetailScroll(), []);
  const replaceWithIndex = useCallback(
    async () => (await adapter.goToIndex(true)).outcome,
    [adapter],
  );

  const closePlaylist = useCallback(
    (playlistId: PlaylistId) => {
      return closeIdentifiedDetail("playlist", playlistId, (hasReturnState) =>
        hasReturnState ? adapter.goBack() : adapter.goToIndex(true),
      );
    },
    [adapter],
  );

  const value = useMemo<PlaylistRouteNavigationValue>(
    () => ({
      closePlaylist,
      openPlaylist,
      replaceWithIndex,
      restoreListContext,
    }),
    [closePlaylist, openPlaylist, replaceWithIndex, restoreListContext],
  );

  return (
    <PlaylistRouteNavigationContext value={value}>
      {children}
    </PlaylistRouteNavigationContext>
  );
}
