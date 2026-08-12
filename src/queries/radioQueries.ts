import {
  infiniteQueryOptions,
  queryOptions,
} from "@tanstack/react-query";
import { fetchRadioShow, fetchRadioShows } from "@/lib";

const RADIO_STALE_TIME_MS = 10 * 60 * 1_000;

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
