import { createFileRoute, Outlet, useMatch } from "@tanstack/react-router";
import { DiscoverScreen } from "@/DiscoverView";
import { useDiscoverRuntime } from "@/features/discover/DiscoverRuntimeContext";
import { validateDiscoverSearch } from "@/routing/routeContracts";
import { codaRouteMeta } from "@/routing/routeMeta";
import { DiscoverRoutePending } from "@/routes/-route-loading";

function DiscoverRouteLayout() {
  const runtime = useDiscoverRuntime();
  const filters = validateDiscoverSearch(Route.useSearch());
  const navigate = Route.useNavigate();
  const releaseMatch = useMatch({
    from: "/discover/releases/$releaseId",
    shouldThrow: false,
  });

  return (
    <>
      <div hidden={Boolean(releaseMatch)}>
        <DiscoverScreen
          {...runtime}
          filters={filters}
          onFiltersChange={(nextFilters) => {
            void navigate({
              replace: true,
              resetScroll: false,
              search: nextFilters,
              to: "/discover",
              viewTransition: false,
            });
          }}
          onOpenRelease={runtime.onOpenRelease}
        />
      </div>
      <Outlet />
    </>
  );
}

export const Route = createFileRoute("/discover")({
  component: DiscoverRouteLayout,
  pendingComponent: DiscoverRoutePending,
  staticData: codaRouteMeta("discover", "discover"),
  validateSearch: validateDiscoverSearch,
});
