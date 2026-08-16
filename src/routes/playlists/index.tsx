import { createFileRoute } from "@tanstack/react-router";

import { playlistsQueryOptions } from "@/queries/savedLibraryQueries";
import { codaRouteMeta } from "@/routing/routeMeta";
import { PlaylistsRoutePending } from "@/routes/-route-loading";
import { PlaylistsIndexRoute } from "./-playlists-index-route";

export const Route = createFileRoute("/playlists/")({
  component: PlaylistsIndexRoute,
  loader: async ({ context }) => {
    await context.authenticatedQueryPreloader.ensureQueryData(
      playlistsQueryOptions(),
    );
  },
  pendingComponent: PlaylistsRoutePending,
  staticData: codaRouteMeta("playlists", "playlists"),
});
