import { createFileRoute } from "@tanstack/react-router";
import { FavoritesScreen } from "@/features/saved-library";
import { useSavedLibraryRuntime } from "@/features/saved-library/SavedLibraryRuntimeContext";
import { codaRouteMeta } from "@/routing/routeMeta";
import { FavoritesRoutePending } from "@/routes/-route-loading";

function FavoritesRoute() {
  const { connected, ...favoritesRuntime } = useSavedLibraryRuntime();
  void connected;
  return <FavoritesScreen {...favoritesRuntime} />;
}

export const Route = createFileRoute("/favorites")({
  component: FavoritesRoute,
  pendingComponent: FavoritesRoutePending,
  staticData: codaRouteMeta("favorites", "favorites"),
});
