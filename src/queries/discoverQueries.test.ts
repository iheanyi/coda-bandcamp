import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoverFilters, DiscoverPage } from "@/types";

const mocks = vi.hoisted(() => ({
  fetchDiscover: vi.fn(),
}));

vi.mock("@/lib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib")>();
  return {
    ...actual,
    fetchDiscover: mocks.fetchDiscover,
  };
});

import { discoverInfiniteQueryOptions } from "./discoverQueries";

const filters: DiscoverFilters = { tag: "ambient", sort: "new" };
const firstPage: DiscoverPage = {
  results: [],
  resultCount: 0,
  cursor: "next-page",
  hasMore: true,
};

beforeEach(() => {
  mocks.fetchDiscover.mockReset().mockResolvedValue(firstPage);
});

describe("discoverInfiniteQueryOptions", () => {
  it("preserves the existing key and loader-safe default options", () => {
    const options = discoverInfiniteQueryOptions(filters);

    expect(options.queryKey).toEqual(["discover", filters]);
    expect(options.queryKey[1]).toBe(filters);
    expect(options.initialPageParam).toBe("*");
    expect(options.enabled).toBeUndefined();
    expect(options.staleTime).toBeUndefined();
    expect(options.gcTime).toBeUndefined();
  });

  it("fetches the initial page and advances only with a usable cursor", async () => {
    const options = discoverInfiniteQueryOptions(filters);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    await queryClient.fetchInfiniteQuery(options);
    expect(mocks.fetchDiscover).toHaveBeenCalledWith(filters, "*");

    const getNextPageParam = options.getNextPageParam;
    expect(getNextPageParam?.(firstPage, [firstPage], "*", ["*"]))
      .toBe("next-page");
    expect(
      getNextPageParam?.(
        { ...firstPage, cursor: undefined },
        [firstPage],
        "*",
        ["*"],
      ),
    ).toBeUndefined();
    expect(
      getNextPageParam?.(
        { ...firstPage, hasMore: false },
        [firstPage],
        "*",
        ["*"],
      ),
    ).toBeUndefined();
  });
});
