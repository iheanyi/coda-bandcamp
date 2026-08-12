import { createFileRoute } from "@tanstack/react-router";
import { codaRouteMeta } from "@/routing/routeMeta";
import { DiscoverRoutePending } from "@/routes/-route-loading";

export const Route = createFileRoute("/discover/")({
  component: () => null,
  pendingComponent: DiscoverRoutePending,
  staticData: codaRouteMeta("discover", "discover"),
});
