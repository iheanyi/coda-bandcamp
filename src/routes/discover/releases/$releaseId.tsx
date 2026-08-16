import {
  createFileRoute,
  notFound,
  type ErrorComponentProps,
  useRouter,
} from "@tanstack/react-router";
import { resolveDiscoverReleaseFromCachePages } from "@/features/discover/discoverCache";
import { discoverInfiniteQueryOptions } from "@/queries/discoverQueries";
import {
  parseDiscoverReleaseIdParam,
  stringifyDiscoverReleaseIdParam,
  validateDiscoverSearch,
} from "@/routing/routeContracts";
import { codaRouteMeta } from "@/routing/routeMeta";
import {
  DiscoverReleaseError,
  DiscoverReleaseNotFound,
  DiscoverReleasePending,
} from "@/routes/discover/-release-status";
import { DiscoverReleaseRoute } from "./-discover-release-route";

function DiscoverReleaseRouteError({ reset }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <DiscoverReleaseError
      onRetry={() => {
        reset();
        void router.invalidate();
      }}
    />
  );
}

export const Route = createFileRoute("/discover/releases/$releaseId")({
  params: {
    parse: ({ releaseId }) => ({
      releaseId: parseDiscoverReleaseIdParam(releaseId),
    }),
    stringify: ({ releaseId }) => ({
      releaseId: stringifyDiscoverReleaseIdParam(releaseId),
    }),
  },
  component: DiscoverReleaseRoute,
  errorComponent: DiscoverReleaseRouteError,
  loaderDeps: ({ search }) => ({
    filters: validateDiscoverSearch(search),
  }),
  loader: async ({ context, deps, params }) => {
    const discoverData = await context.queryClient.ensureInfiniteQueryData(
      discoverInfiniteQueryOptions(deps.filters),
    );
    const release = resolveDiscoverReleaseFromCachePages(
      discoverData.pages,
      params.releaseId,
    );

    if (release.status === "missing") {
      // A direct reload intentionally primes only the first Discover page. We do
      // not crawl opaque cursors to locate an arbitrary ID or return signed feed
      // objects through loader data.
      throw notFound();
    }
    if (release.status === "lookup-limit-reached") {
      throw new Error("Discover release lookup exceeded the supported limit");
    }
  },
  notFoundComponent: DiscoverReleaseNotFound,
  pendingComponent: DiscoverReleasePending,
  staticData: codaRouteMeta("discover-release", "discover"),
});
