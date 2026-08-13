import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchDailyArticle: vi.fn(),
  fetchDailyArticles: vi.fn(),
}));

vi.mock("@/lib", () => mocks);

import {
  dailyArticleQueryOptions,
  dailyArticlesInfiniteQueryOptions,
} from "./dailyQueries";

describe("Bandcamp Daily queries", () => {
  it("keys paginated category feeds independently", async () => {
    mocks.fetchDailyArticles.mockResolvedValue({
      hasMore: true,
      page: 2,
      results: [],
    });
    const options = dailyArticlesInfiniteQueryOptions("features");

    expect(options.queryKey).toEqual(["bandcamp-daily", "features"]);
    await options.queryFn?.({ pageParam: 2 } as never);
    expect(mocks.fetchDailyArticles).toHaveBeenCalledWith("features", 2);
    expect(
      options.getNextPageParam?.(
        { hasMore: true, page: 2 } as never,
        [],
        2,
        [],
      ),
    ).toBe(3);
  });

  it("loads article music separately from signed-stream-free feed summaries", async () => {
    mocks.fetchDailyArticle.mockResolvedValue({ embeds: [] });
    const options = dailyArticleQueryOptions("lists", "night-music");

    expect(options.queryKey).toEqual([
      "bandcamp-daily-article",
      "lists",
      "night-music",
    ]);
    await options.queryFn?.({} as never);
    expect(mocks.fetchDailyArticle).toHaveBeenCalledWith(
      "lists",
      "night-music",
    );
  });
});
