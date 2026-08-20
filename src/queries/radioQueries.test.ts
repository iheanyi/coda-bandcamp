import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RadioShow, RadioShowSummary, RadioShowsPage } from "@/types";

import {
  findRadioShowSummaryInCache,
  mergeRadioShowSeries,
  radioShowQueryOptions,
  radioShowRestoreQueryOptions,
  radioShowsInfiniteQueryOptions,
  type RadioQueryRepository,
} from "./radioQueries";

const repository = {
  fetchShow: vi.fn<RadioQueryRepository["fetchShow"]>(),
  fetchShows: vi.fn<RadioQueryRepository["fetchShows"]>(),
};

const page: RadioShowsPage = {
  results: [],
  cursor: "radio-next",
  hasMore: true,
};
const show: RadioShow = {
  id: 979,
  title: "Bandcamp Weekly",
  subtitle: "A new episode",
  description: "Independent music",
  publishedAt: "2026-08-11",
  duration: 3_600,
  streamUrl: "https://bandcamp.com/signed-stream",
  chapters: [],
};

function archiveData(summary: RadioShowSummary) {
  return {
    pages: [{ ...page, results: [summary] }],
    pageParams: [null],
  };
}

beforeEach(() => {
  repository.fetchShows.mockReset().mockResolvedValue(page);
  repository.fetchShow.mockReset().mockResolvedValue(show);
});

describe("Radio query options", () => {
  it("preserves archive keys, page parameters, and cache timing", () => {
    const allShows = radioShowsInfiniteQueryOptions();
    const seriesShows = radioShowsInfiniteQueryOptions(5);

    expect(allShows.queryKey).toEqual(["bandcamp-radio", "all"]);
    expect(seriesShows.queryKey).toEqual(["bandcamp-radio", 5]);
    expect(allShows.initialPageParam).toBeNull();
    expect(allShows.staleTime).toBe(10 * 60 * 1_000);
    expect(allShows.gcTime).toBeUndefined();
    expect(allShows.enabled).toBeUndefined();

    const getNextPageParam = allShows.getNextPageParam;
    expect(getNextPageParam?.(page, [page], null, [null])).toBe("radio-next");
    expect(
      getNextPageParam?.(
        { ...page, hasMore: false },
        [page],
        null,
        [null],
      ),
    ).toBeUndefined();
  });

  it("forwards archive scope and initial cursor through QueryClient", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    await queryClient.fetchInfiniteQuery(
      radioShowsInfiniteQueryOptions(undefined, repository),
    );
    await queryClient.fetchInfiniteQuery(
      radioShowsInfiniteQueryOptions(5, repository),
    );

    expect(repository.fetchShows).toHaveBeenNthCalledWith(1, {
      seriesId: undefined,
      cursor: undefined,
    });
    expect(repository.fetchShows).toHaveBeenNthCalledWith(2, {
      seriesId: 5,
      cursor: undefined,
    });
  });

  it("preserves the show-detail key and stale time", async () => {
    const options = radioShowQueryOptions(979, repository);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    expect(options.queryKey).toEqual(["bandcamp-radio-show", 979]);
    expect(options.staleTime).toBe(10 * 60 * 1_000);
    expect(options.gcTime).toBeUndefined();
    expect(await queryClient.fetchQuery(options)).toEqual(show);
    expect(repository.fetchShow).toHaveBeenCalledWith(979);
    expect(await queryClient.fetchQuery(options)).toEqual(show);
    expect(repository.fetchShow).toHaveBeenCalledTimes(1);
  });

  it("bypasses a warm show cache when restoring a signed stream", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const staleShow: RadioShow = {
      ...show,
      streamUrl: "https://bandcamp.com/stale-signed-stream",
    };
    queryClient.setQueryData(radioShowQueryOptions(979).queryKey, staleShow);
    repository.fetchShow.mockResolvedValue(show);

    const restored = await queryClient.fetchQuery(
      radioShowRestoreQueryOptions(979, repository),
    );

    expect(radioShowRestoreQueryOptions(979).queryKey).toEqual([
      "bandcamp-radio-show",
      979,
    ]);
    expect(radioShowRestoreQueryOptions(979).staleTime).toBe(0);
    expect(repository.fetchShow).toHaveBeenCalledWith(979);
    expect(restored.streamUrl).toBe(show.streamUrl);
    expect(restored.streamUrl).not.toBe(staleShow.streamUrl);
  });

  it("resolves a stripped archive summary without creating another cache", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(["bandcamp-radio", "all"], {
      pages: [
        {
          ...page,
          results: [
            {
              ...show,
              artworkUrl: "https://f4.bcbits.com/img/radio-summary.jpg",
            },
          ],
        },
      ],
      pageParams: [null],
    });

    const queryCount = queryClient.getQueryCache().getAll().length;
    const summary = findRadioShowSummaryInCache(queryClient, show.id);

    expect(summary).toEqual({
      id: show.id,
      subtitle: show.subtitle,
      description: show.description,
      publishedAt: show.publishedAt,
      artworkUrl: "https://f4.bcbits.com/img/radio-summary.jpg",
    });
    expect(summary).not.toHaveProperty("streamUrl");
    expect(summary).not.toHaveProperty("chapters");
    expect(queryClient.getQueryCache().getAll()).toHaveLength(queryCount);
    expect(
      queryClient.getQueryData(["bandcamp-radio-summary", show.id]),
    ).toBeUndefined();
  });

  it("prefers the requested scope, then the newest cache timestamp", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const staleAll: RadioShowSummary = {
      id: show.id,
      subtitle: "Stale all-shows title",
      description: "Older all-shows metadata",
      publishedAt: "2026-08-10",
    };
    const currentSeries: RadioShowSummary = {
      id: show.id,
      subtitle: "Current series title",
      description: "Newer series metadata",
      publishedAt: "2026-08-12",
      series: {
        id: 5,
        title: "The Hip Hop Show",
        slug: "the-hip-hop-show",
      },
    };
    queryClient.setQueryData(
      radioShowsInfiniteQueryOptions().queryKey,
      archiveData(staleAll),
      { updatedAt: 1_000 },
    );
    queryClient.setQueryData(
      radioShowsInfiniteQueryOptions(5).queryKey,
      archiveData(currentSeries),
      { updatedAt: 2_000 },
    );

    expect(findRadioShowSummaryInCache(queryClient, show.id)).toEqual(
      currentSeries,
    );
    expect(findRadioShowSummaryInCache(queryClient, show.id, "all")).toEqual(
      staleAll,
    );

    const refreshedAll = {
      ...staleAll,
      subtitle: "Refreshed all-shows title",
    };
    queryClient.setQueryData(
      radioShowsInfiniteQueryOptions().queryKey,
      archiveData(refreshedAll),
      { updatedAt: 3_000 },
    );
    expect(findRadioShowSummaryInCache(queryClient, show.id)).toEqual(
      refreshedAll,
    );
  });

  it("copies missing series metadata onto a loaded show", () => {
    const series = {
      id: 5,
      title: "The Hip Hop Show",
      slug: "the-hip-hop-show",
    };
    expect(mergeRadioShowSeries(show, { series })).toEqual({
      ...show,
      series,
    });
    expect(mergeRadioShowSeries({ ...show, series }, { series: { ...series, id: 9 } })).toEqual({
      ...show,
      series,
    });
    expect(mergeRadioShowSeries(show)).toBe(show);
  });
});
