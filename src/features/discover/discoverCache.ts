import type { DiscoverReleaseId } from "@/routing/routeContracts";
import type { DiscoverPage, DiscoverRelease } from "@/types";

const MAX_CACHE_LOOKUP_PAGES = 128;
const MAX_CACHE_LOOKUP_RELEASES = 5_120;

export type DiscoverReleaseCacheLookup =
  | Readonly<{
      status: "found";
      release: DiscoverRelease;
    }>
  | Readonly<{
      status: "missing";
    }>
  | Readonly<{
      status: "lookup-limit-reached";
    }>;

/**
 * Returns the cache-owned release reference without cloning signed media data.
 * Route loaders should inspect only the status and return void; detail screens
 * can consume the reference from TanStack Query's cache.
 */
export function resolveDiscoverReleaseFromCachePages(
  pages: ReadonlyArray<Pick<DiscoverPage, "results">> | undefined,
  releaseId: DiscoverReleaseId,
): DiscoverReleaseCacheLookup {
  if (!pages) return { status: "missing" };

  let inspectedReleases = 0;
  const pageCount = Math.min(pages.length, MAX_CACHE_LOOKUP_PAGES);
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const page = pages[pageIndex];
    if (!page) continue;
    for (const release of page.results) {
      if (inspectedReleases >= MAX_CACHE_LOOKUP_RELEASES) {
        return { status: "lookup-limit-reached" };
      }
      inspectedReleases += 1;
      if (release.id === releaseId) {
        return { status: "found", release };
      }
    }
  }

  return pages.length > pageCount
    ? { status: "lookup-limit-reached" }
    : { status: "missing" };
}
