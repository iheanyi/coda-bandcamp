import { createFileRoute, Outlet } from "@tanstack/react-router";

import { usePlaylistRouteNavigationAdapter } from "@/features/navigation";
import { PlaylistRouteNavigationProvider } from "@/features/saved-library/PlaylistRouteNavigationContext";
import { codaRouteMeta } from "@/routing/routeMeta";
import { PlaylistsRoutePending } from "@/routes/-route-loading";

function PlaylistsRouteLayout() {
  const adapter = usePlaylistRouteNavigationAdapter();

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
