import { infiniteQueryOptions } from "@tanstack/react-query";
import { fetchDiscover } from "@/lib";
import { cursorNextPageParam } from "@/queries/anonymousFeed";
import type { DiscoverFilters } from "@/types";

export function discoverInfiniteQueryOptions(filters: DiscoverFilters) {
  return infiniteQueryOptions({
    queryKey: ["discover", filters] as const,
    queryFn: ({ pageParam }) => fetchDiscover(filters, pageParam),
    initialPageParam: "*",
    getNextPageParam: (lastPage) => cursorNextPageParam(lastPage),
  });
}
