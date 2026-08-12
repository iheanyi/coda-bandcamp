import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RadioShow, RadioShowsPage } from "@/types";

const mocks = vi.hoisted(() => ({
  fetchRadioShow: vi.fn(),
  fetchRadioShows: vi.fn(),
}));

vi.mock("@/lib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib")>();
  return {
    ...actual,
    fetchRadioShow: mocks.fetchRadioShow,
    fetchRadioShows: mocks.fetchRadioShows,
  };
});

import {
  radioShowQueryOptions,
  radioShowsInfiniteQueryOptions,
} from "./radioQueries";

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

beforeEach(() => {
  mocks.fetchRadioShows.mockReset().mockResolvedValue(page);
  mocks.fetchRadioShow.mockReset().mockResolvedValue(show);
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

    await queryClient.fetchInfiniteQuery(radioShowsInfiniteQueryOptions());
    await queryClient.fetchInfiniteQuery(radioShowsInfiniteQueryOptions(5));

    expect(mocks.fetchRadioShows).toHaveBeenNthCalledWith(1, {
      seriesId: undefined,
      cursor: undefined,
    });
    expect(mocks.fetchRadioShows).toHaveBeenNthCalledWith(2, {
      seriesId: 5,
      cursor: undefined,
    });
  });

  it("preserves the show-detail key and stale time", async () => {
    const options = radioShowQueryOptions(979);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    expect(options.queryKey).toEqual(["bandcamp-radio-show", 979]);
    expect(options.staleTime).toBe(10 * 60 * 1_000);
    expect(options.gcTime).toBeUndefined();
    expect(await queryClient.fetchQuery(options)).toEqual(show);
    expect(mocks.fetchRadioShow).toHaveBeenCalledWith(979);
  });
});
