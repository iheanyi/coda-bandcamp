import { createFileRoute } from "@tanstack/react-router";

import { radioShowsInfiniteQueryOptions } from "@/queries/radioQueries";
import { codaRouteMeta } from "@/routing/routeMeta";
import { RadioArchiveRoute } from "@/routes/radio/-radio-archive-route";
import {
  RadioArchivePending,
  RadioRouteError,
  RadioRouteNotFound,
} from "@/routes/radio/-radio-route-status";

export const Route = createFileRoute("/radio/")({
  component: RadioArchiveRoute,
  errorComponent: RadioRouteError,
  loader: async ({ context }) => {
    await context.queryClient.ensureInfiniteQueryData(
      radioShowsInfiniteQueryOptions(),
    );
  },
  notFoundComponent: RadioRouteNotFound,
  pendingComponent: RadioArchivePending,
  staticData: codaRouteMeta("radio", "radio"),
});
