import { useInfiniteQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  notFound,
  type ErrorComponentProps,
  useRouter,
} from "@tanstack/react-router";
import { DiscoverReleaseScreen } from "@/DiscoverReleaseDetail";
import { resolveDiscoverReleaseFromCachePages } from "@/features/discover/discoverCache";
import { useDiscoverRuntime } from "@/features/discover/DiscoverRuntimeContext";
import { openBandcampUrl } from "@/lib";
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

function DiscoverReleaseRoute() {
  const runtime = useDiscoverRuntime();
  const { releaseId } = Route.useParams();
  const filters = validateDiscoverSearch(Route.useSearch());
  const router = useRouter();
  const query = useInfiniteQuery({
    ...discoverInfiniteQueryOptions(filters),
    // The persistent parent screen already owns this query. Mounting a second
    // stale observer must not refetch page one and replace its accumulated
    // infinite-query pages while opening a release detail.
    refetchOnMount: false,
  });

  if (query.isPending) return <DiscoverReleasePending />;
  if (query.isError) {
    return (
      <DiscoverReleaseError
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }

  const release = resolveDiscoverReleaseFromCachePages(
    query.data.pages,
    releaseId,
  );
  if (release.status === "missing") return <DiscoverReleaseNotFound />;
  if (release.status === "lookup-limit-reached") {
    return (
      <DiscoverReleaseError
        onRetry={() => {
          void router.invalidate();
        }}
      />
    );
  }

  return (
    <DiscoverReleaseScreen
      currentTrackId={runtime.currentTrackId}
      onArtist={runtime.onOpenArtist}
      onBack={runtime.onCloseRelease}
      onOpenBandcamp={(url) => {
        void openBandcampUrl(url);
      }}
      onPlay={runtime.onPlay}
      onQueue={runtime.onQueue}
      onTogglePlayback={runtime.onTogglePlayback}
      playing={runtime.playing}
      release={release.release}
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
