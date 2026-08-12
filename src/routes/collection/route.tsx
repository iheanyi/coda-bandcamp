import { createFileRoute, Outlet } from "@tanstack/react-router";
import { validateCollectionSearch } from "@/routing/routeContracts";
import { codaRouteMeta } from "@/routing/routeMeta";
import { CollectionRoutePending } from "@/routes/-route-loading";

export const Route = createFileRoute("/collection")({
  component: Outlet,
  pendingComponent: CollectionRoutePending,
  staticData: codaRouteMeta("collection", "library"),
  validateSearch: validateCollectionSearch,
});
