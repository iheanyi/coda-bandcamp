import { createFileRoute } from "@tanstack/react-router";
import { RecentRouteScreen } from "@/features/library/RecentRouteScreen";
import { validateCollectionSearch } from "@/routing/routeContracts";
import { codaRouteMeta } from "@/routing/routeMeta";
import { RecentRoutePending } from "@/routes/-route-loading";

export const Route = createFileRoute("/recent")({
  component: RecentRouteScreen,
  pendingComponent: RecentRoutePending,
  staticData: codaRouteMeta("recent", "recent"),
  validateSearch: validateCollectionSearch,
});
