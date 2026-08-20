import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";

import { fetchDailyArticle, fetchDailyArticles } from "@/lib";
import {
  ANONYMOUS_FEED_STALE_TIME_MS,
  sequentialNextPageParam,
} from "@/queries/anonymousFeed";
import type { DailyCategory } from "@/types";

export function dailyArticlesInfiniteQueryOptions(category: DailyCategory) {
  return infiniteQueryOptions({
    queryKey: ["bandcamp-daily", category] as const,
    queryFn: ({ pageParam }) => fetchDailyArticles(category, pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => sequentialNextPageParam(lastPage),
    staleTime: ANONYMOUS_FEED_STALE_TIME_MS,
  });
}

export function dailyArticleQueryOptions(
  articleSection: string,
  slug: string,
) {
  return queryOptions({
    queryKey: ["bandcamp-daily-article", articleSection, slug] as const,
    queryFn: () => fetchDailyArticle(articleSection, slug),
    staleTime: ANONYMOUS_FEED_STALE_TIME_MS,
  });
}
