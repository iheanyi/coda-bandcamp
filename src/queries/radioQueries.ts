import {
  type InfiniteData,
  type QueryClient,
  type QueryFunctionContext,
  infiniteQueryOptions,
  queryOptions,
  skipToken,
} from "@tanstack/react-query";
import { fetchRadioShow, fetchRadioShows } from "@/lib";
import {
  ANONYMOUS_FEED_STALE_TIME_MS,
  cursorNextPageParam,
} from "@/queries/anonymousFeed";
import { BANDCAMP_RADIO_SERIES } from "@/radioSeries";
import type { RadioShowSummary, RadioShowsPage } from "@/types";

export type RadioArchiveScope = number | "all";
type RadioArchiveQueryKey = readonly [
  "bandcamp-radio",
  RadioArchiveScope,
];
type RadioArchivePageParam = string | null;

export type RadioShowSummaryCandidate = Readonly<{
  dataUpdatedAt: number;
  scope: RadioArchiveScope;
  summary: RadioShowSummary;
}>;

export type RadioQueryRepository = Readonly<{
  fetchShow: typeof fetchRadioShow;
  fetchShows: typeof fetchRadioShows;
}>;

const defaultRadioQueryRepository: RadioQueryRepository = {
  fetchShow: fetchRadioShow,
  fetchShows: fetchRadioShows,
};

export function radioShowsInfiniteQueryOptions(
  seriesId?: number,
  repository: RadioQueryRepository = defaultRadioQueryRepository,
) {
  return infiniteQueryOptions({
    queryKey: ["bandcamp-radio", seriesId ?? "all"] as const,
    queryFn: ({
      pageParam,
    }: QueryFunctionContext<RadioArchiveQueryKey, RadioArchivePageParam>) =>
      repository.fetchShows({
        seriesId,
        cursor: pageParam ?? undefined,
      }),
    initialPageParam: null,
    getNextPageParam: (page) => cursorNextPageParam(page),
    staleTime: ANONYMOUS_FEED_STALE_TIME_MS,
  });
}

export function radioShowQueryOptions(
  showId: number,
  repository: RadioQueryRepository = defaultRadioQueryRepository,
) {
  return queryOptions({
    queryKey: ["bandcamp-radio-show", showId] as const,
    queryFn: () => repository.fetchShow(showId),
    staleTime: ANONYMOUS_FEED_STALE_TIME_MS,
  });
}

/**
 * Session restore and media reacquisition must fetch a live signed stream.
 * In-session Radio queueing keeps `radioShowQueryOptions` and its 10-minute cache.
 */
export function radioShowRestoreQueryOptions(
  showId: number,
  repository: RadioQueryRepository = defaultRadioQueryRepository,
) {
  return queryOptions({
    ...radioShowQueryOptions(showId, repository),
    staleTime: 0,
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
  return BANDCAMP_RADIO_SERIES.find((series) => series.id === scope)?.id;
}

function radioShowSummaryFromArchive(
  archive: InfiniteData<RadioShowsPage> | undefined,
  showId: number,
): RadioShowSummary | undefined {
  for (const page of archive?.pages ?? []) {
    const show = page.results.find((candidate) => candidate.id === showId);
    if (!show) continue;
    const summary: RadioShowSummary = {
      id: show.id,
      subtitle: show.subtitle,
      description: show.description,
      publishedAt: show.publishedAt,
    };
    if (show.artworkUrl) summary.artworkUrl = show.artworkUrl;
    if (show.series) {
      summary.series = {
        id: show.series.id,
        title: show.series.title,
        slug: show.series.slug,
      };
    }
    return summary;
  }
  return undefined;
}

export function mergeRadioShowSeries<T extends { series?: RadioShowSummary["series"] }>(
  loaded: T,
  fallback?: Pick<RadioShowSummary, "series">,
): T {
  if (loaded.series || !fallback?.series) return loaded;
  return { ...loaded, series: fallback.series };
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
