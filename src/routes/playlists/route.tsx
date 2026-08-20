import { createFileRoute, Outlet } from "@tanstack/react-router";

import {
  PLAYLIST_ROUTE_SPEC,
  useRouteNavigationAdapter,
} from "@/features/navigation";
import { PlaylistRouteNavigationProvider } from "@/features/saved-library/PlaylistRouteNavigationContext";
import { codaRouteMeta } from "@/routing/routeMeta";
import { PlaylistsRoutePending } from "@/routes/-route-loading";

function PlaylistsRouteLayout() {
  const adapter = useRouteNavigationAdapter(PLAYLIST_ROUTE_SPEC);

  return (
    <PlaylistRouteNavigationProvider adapter={adapter}>
      <Outlet />
    </PlaylistRouteNavigationProvider>
  );
}

export const Route = createFileRoute("/playlists")({
  component: PlaylistsRouteLayout,
  pendingComponent: PlaylistsRoutePending,
  staticData: codaRouteMeta("playlists", "playlists"),
});
