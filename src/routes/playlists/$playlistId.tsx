import { createFileRoute } from "@tanstack/react-router";

import { playlistQueryOptions } from "@/queries/savedLibraryQueries";
import {
  parsePlaylistIdParam,
  stringifyPlaylistIdParam,
} from "@/routing/routeContracts";
import { codaRouteMeta } from "@/routing/routeMeta";
import { PlaylistRoutePending } from "@/routes/-route-loading";
import { PlaylistDetailRoute } from "./-playlist-detail-route";

export const Route = createFileRoute("/playlists/$playlistId")({
  component: PlaylistDetailRoute,
  pendingComponent: PlaylistRoutePending,
  params: {
    parse: ({ playlistId }) => ({
      playlistId: parsePlaylistIdParam(playlistId),
    }),
    stringify: ({ playlistId }) => ({
      playlistId: stringifyPlaylistIdParam(playlistId),
    }),
  },
  loader: async ({ context, params }) => {
    await context.authenticatedQueryPreloader.ensureQueryData(
      playlistQueryOptions(params.playlistId),
    );
  },
  staticData: codaRouteMeta("playlist", "playlists"),
});
