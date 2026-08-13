import { createFileRoute, Outlet, useMatch } from "@tanstack/react-router";

import { DailyArchiveScreen } from "@/features/daily/DailyScreens";
import { DailyRouteNavigationProvider } from "@/features/daily/DailyRouteNavigationContext";
import { useDailyRouteNavigationAdapter } from "@/features/navigation";
import { validateDailySearch } from "@/routing/routeContracts";
import { codaRouteMeta } from "@/routing/routeMeta";
import { DailyRoutePending } from "@/routes/-route-loading";

function DailyRouteLayout() {
  const adapter = useDailyRouteNavigationAdapter();
  const { category } = validateDailySearch(Route.useSearch());
  const articleMatch = useMatch({
    from: "/daily/$slug",
    shouldThrow: false,
  });

  return (
    <DailyRouteNavigationProvider adapter={adapter}>
      <div hidden={Boolean(articleMatch)}>
        <DailyArchiveScreen category={category} />
      </div>
      <Outlet />
    </DailyRouteNavigationProvider>
  );
}

export const Route = createFileRoute("/daily")({
  component: DailyRouteLayout,
  pendingComponent: DailyRoutePending,
  staticData: codaRouteMeta("daily", "daily"),
  validateSearch: validateDailySearch,
});
