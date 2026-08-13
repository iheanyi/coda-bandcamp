import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";

import { fetchDailyArticle, fetchDailyArticles } from "@/lib";
import type { DailyCategory } from "@/types";

const DAILY_STALE_TIME_MS = 10 * 60 * 1_000;

export function dailyArticlesInfiniteQueryOptions(category: DailyCategory) {
  return infiniteQueryOptions({
    queryKey: ["bandcamp-daily", category] as const,
    queryFn: ({ pageParam }) => fetchDailyArticles(category, pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.page + 1 : undefined,
    staleTime: DAILY_STALE_TIME_MS,
  });
}

export function dailyArticleQueryOptions(
  category: DailyCategory,
  slug: string,
) {
  return queryOptions({
    queryKey: ["bandcamp-daily-article", category, slug] as const,
    queryFn: () => fetchDailyArticle(category, slug),
    staleTime: DAILY_STALE_TIME_MS,
  });
}
