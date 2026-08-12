import { createFileRoute } from "@tanstack/react-router";
import { CollectionRouteScreen } from "@/features/library/CollectionRouteScreen";
import { codaRouteMeta } from "@/routing/routeMeta";
import { CollectionRoutePending } from "@/routes/-route-loading";

export const Route = createFileRoute("/collection/")({
  component: CollectionRouteScreen,
  pendingComponent: CollectionRoutePending,
  staticData: codaRouteMeta("collection", "library"),
});
