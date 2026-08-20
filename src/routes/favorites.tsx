import { createFileRoute } from "@tanstack/react-router";
import { FavoritesScreen } from "@/features/saved-library";
import { codaRouteMeta } from "@/routing/routeMeta";
import { FavoritesRoutePending } from "@/routes/-route-loading";

export const Route = createFileRoute("/favorites")({
  component: FavoritesScreen,
  pendingComponent: FavoritesRoutePending,
  staticData: codaRouteMeta("favorites", "favorites"),
});
