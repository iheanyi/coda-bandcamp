import { createFileRoute } from "@tanstack/react-router";
import { validateDiscoverSearch } from "@/routing/routeContracts";
import { codaRouteMeta } from "@/routing/routeMeta";
import { DiscoverRoutePending } from "@/routes/-route-loading";
import { DiscoverRouteLayout } from "./-discover-route-layout";

export const Route = createFileRoute("/discover")({
  component: DiscoverRouteLayout,
  pendingComponent: DiscoverRoutePending,
  staticData: codaRouteMeta("discover", "discover"),
  validateSearch: validateDiscoverSearch,
});
