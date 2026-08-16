import {
  type InfiniteData,
  type QueryClient,
  infiniteQueryOptions,
  queryOptions,
  skipToken,
} from "@tanstack/react-query";
import { fetchRadioShow, fetchRadioShows } from "@/lib";
import type { RadioShowSummary, RadioShowsPage } from "@/types";

const RADIO_STALE_TIME_MS = 10 * 60 * 1_000;

export type RadioArchiveScope = number | "all";

export type RadioShowSummaryCandidate = Readonly<{
  dataUpdatedAt: number;
  scope: RadioArchiveScope;
  summary: RadioShowSummary;
}>;

export function radioShowsInfiniteQueryOptions(seriesId?: number) {
  return infiniteQueryOptions({
    queryKey: ["bandcamp-radio", seriesId ?? "all"] as const,
    queryFn: ({ pageParam }) =>
      fetchRadioShows({
        seriesId,
        cursor: pageParam ?? undefined,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) =>
      page.hasMore && page.cursor ? page.cursor : undefined,
    staleTime: RADIO_STALE_TIME_MS,
  });
}

export function radioShowQueryOptions(showId: number) {
  return queryOptions({
    queryKey: ["bandcamp-radio-show", showId] as const,
    queryFn: () => fetchRadioShow(showId),
    staleTime: RADIO_STALE_TIME_MS,
  });
}

function radioArchiveScopeFromQueryKey(
  queryKey: readonly unknown[],
): RadioArchiveScope | undefined {
  if (queryKey.length !== 2 || queryKey[0] !== "bandcamp-radio") {
    return undefined;
  }
  const scope = queryKey[1];
  if (scope === "all") return scope;
  return typeof scope === "number" &&
    Number.isSafeInteger(scope) &&
    scope > 0
    ? scope
    : undefined;
}

function radioShowSummaryFromArchive(
  archive: InfiniteData<RadioShowsPage> | undefined,
  showId: number,
): RadioShowSummary | undefined {
  for (const page of archive?.pages ?? []) {
    const show = page.results.find((candidate) => candidate.id === showId);
    if (!show) continue;
    return {
      id: show.id,
      subtitle: show.subtitle,
      description: show.description,
      publishedAt: show.publishedAt,
      ...(show.artworkUrl ? { artworkUrl: show.artworkUrl } : {}),
      ...(show.series
        ? {
            series: {
              id: show.series.id,
              title: show.series.title,
              slug: show.series.slug,
            },
          }
        : {}),
    };
  }
  return undefined;
}

export function radioShowSummaryCandidatesInCache(
  queryClient: QueryClient,
  showId: number,
): RadioShowSummaryCandidate[] {
  const candidates: RadioShowSummaryCandidate[] = [];
  const archiveQueries = queryClient.getQueriesData<
    InfiniteData<RadioShowsPage>
  >({
    queryKey: ["bandcamp-radio"],
  });

  for (const [queryKey, archive] of archiveQueries) {
    const scope = radioArchiveScopeFromQueryKey(queryKey);
    const summary = radioShowSummaryFromArchive(archive, showId);
    if (scope === undefined || !summary) continue;
    candidates.push({
      dataUpdatedAt: queryClient.getQueryState(queryKey)?.dataUpdatedAt ?? 0,
      scope,
      summary,
    });
  }

  return candidates;
}

function scopeWinsTie(
  candidate: RadioArchiveScope,
  current: RadioArchiveScope,
): boolean {
  if (candidate === current) return false;
  if (candidate === "all") return false;
  if (current === "all") return true;
  return candidate < current;
}

export function selectRadioShowSummary(
  candidates: readonly RadioShowSummaryCandidate[],
  preferredScope?: RadioArchiveScope,
): RadioShowSummary | undefined {
  const preferred = candidates.find(
    (candidate) => candidate.scope === preferredScope,
  );
  if (preferred) return preferred.summary;

  let selected: RadioShowSummaryCandidate | undefined;
  for (const candidate of candidates) {
    if (
      !selected ||
      candidate.dataUpdatedAt > selected.dataUpdatedAt ||
      (candidate.dataUpdatedAt === selected.dataUpdatedAt &&
        scopeWinsTie(candidate.scope, selected.scope))
    ) {
      selected = candidate;
    }
  }
  return selected?.summary;
}

export function findRadioShowSummaryInCache(
  queryClient: QueryClient,
  showId: number,
  preferredScope?: RadioArchiveScope,
): RadioShowSummary | undefined {
  return selectRadioShowSummary(
    radioShowSummaryCandidatesInCache(queryClient, showId),
    preferredScope,
  );
}

export function radioShowSummaryObserverOptions(
  scope: RadioArchiveScope,
  showId: number,
) {
  const archiveOptions = radioShowsInfiniteQueryOptions(
    scope === "all" ? undefined : scope,
  );
  return queryOptions({
    queryKey: archiveOptions.queryKey,
    queryFn: skipToken,
    select: (archive: InfiniteData<RadioShowsPage>) =>
      radioShowSummaryFromArchive(archive, showId),
  });
}
