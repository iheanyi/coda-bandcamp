import { useInfiniteQuery } from "@tanstack/react-query";
import { getRouteApi, useRouter } from "@tanstack/react-router";
import type { ComponentType } from "react";

import {
  DiscoverReleaseScreen as DefaultDiscoverReleaseScreen,
  type DiscoverReleaseScreenProps,
} from "@/DiscoverReleaseDetail";
import { resolveDiscoverReleaseFromCachePages } from "@/features/discover/discoverCache";
import { useDiscoverRuntime } from "@/features/discover/DiscoverRuntimeContext";
import { openBandcampUrl } from "@/lib";
import { discoverInfiniteQueryOptions } from "@/queries/discoverQueries";
import { validateDiscoverSearch } from "@/routing/routeContracts";
import {
  DiscoverReleaseError,
  DiscoverReleaseNotFound,
  DiscoverReleasePending,
} from "@/routes/discover/-release-status";

const discoverReleaseRouteApi = getRouteApi(
  "/discover/releases/$releaseId",
);

export function DiscoverReleaseRoute({
  Screen = DefaultDiscoverReleaseScreen,
}: Readonly<{
  Screen?: ComponentType<DiscoverReleaseScreenProps>;
}> = {}) {
  const runtime = useDiscoverRuntime();
  const { releaseId } = discoverReleaseRouteApi.useParams();
  const filters = validateDiscoverSearch(discoverReleaseRouteApi.useSearch());
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
    <Screen
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
