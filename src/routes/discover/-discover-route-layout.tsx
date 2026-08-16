import {
  getRouteApi,
  Outlet,
  useMatch,
} from "@tanstack/react-router";
import type { ComponentType } from "react";

import {
  DiscoverScreen as DefaultDiscoverScreen,
  type DiscoverScreenProps,
} from "@/DiscoverView";
import { useDiscoverRuntime } from "@/features/discover/DiscoverRuntimeContext";
import { validateDiscoverSearch } from "@/routing/routeContracts";

const discoverRouteApi = getRouteApi("/discover");

export function DiscoverRouteLayout({
  Screen = DefaultDiscoverScreen,
}: Readonly<{
  Screen?: ComponentType<DiscoverScreenProps>;
}> = {}) {
  const runtime = useDiscoverRuntime();
  const filters = validateDiscoverSearch(discoverRouteApi.useSearch());
  const navigate = discoverRouteApi.useNavigate();
  const releaseMatch = useMatch({
    from: "/discover/releases/$releaseId",
    shouldThrow: false,
  });

  return (
    <>
      <div hidden={Boolean(releaseMatch)}>
        <Screen
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
