import { createFileRoute } from "@tanstack/react-router";

import { codaRouteMeta } from "@/routing/routeMeta";
import { PlaylistsRoutePending } from "@/routes/-route-loading";
import { PlaylistsIndexRoute } from "./-playlists-index-route";

export const Route = createFileRoute("/playlists/")({
  component: PlaylistsIndexRoute,
  pendingComponent: PlaylistsRoutePending,
  staticData: codaRouteMeta("playlists", "playlists"),
});
