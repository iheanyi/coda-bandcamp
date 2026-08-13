import { createFileRoute, Outlet, useMatch } from "@tanstack/react-router";

import { DailyArchiveScreen } from "@/features/daily/DailyScreens";
import { dailyArticlesInfiniteQueryOptions } from "@/queries/dailyQueries";
import { validateDailySearch } from "@/routing/routeContracts";
import { codaRouteMeta } from "@/routing/routeMeta";
import { DailyRoutePending } from "@/routes/-route-loading";

function DailyRouteLayout() {
  const { category } = validateDailySearch(Route.useSearch());
  const articleMatch = useMatch({
    from: "/daily/$slug",
    shouldThrow: false,
  });

  return (
    <>
      <div hidden={Boolean(articleMatch)}>
        <DailyArchiveScreen category={category} />
      </div>
      <Outlet />
    </>
  );
}

export const Route = createFileRoute("/daily")({
  component: DailyRouteLayout,
  loaderDeps: ({ search }) => validateDailySearch(search),
  loader: ({ context, deps }) =>
    context.queryClient.ensureInfiniteQueryData(
      dailyArticlesInfiniteQueryOptions(deps.category),
    ),
  pendingComponent: DailyRoutePending,
  staticData: codaRouteMeta("daily", "daily"),
  validateSearch: validateDailySearch,
});
