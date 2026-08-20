export const ANONYMOUS_FEED_STALE_TIME_MS = 10 * 60 * 1_000;

export function cursorNextPageParam(page: {
  cursor?: string | null;
  hasMore: boolean;
}): string | undefined {
  return page.hasMore && page.cursor ? page.cursor : undefined;
}

export function sequentialNextPageParam(page: {
  hasMore: boolean;
  page: number;
}): number | undefined {
  return page.hasMore ? page.page + 1 : undefined;
}
