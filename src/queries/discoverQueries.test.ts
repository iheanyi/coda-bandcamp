import { QueryClient } from "@tanstack/react-query";
import type { InvokeArgs } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoverFilters, DiscoverPage } from "@/types";

import { discoverInfiniteQueryOptions } from "./discoverQueries";

const filters: DiscoverFilters = { tag: "ambient", sort: "new" };
const firstPage: DiscoverPage = {
  results: [],
  resultCount: 0,
  cursor: "next-page",
  hasMore: true,
};

const nativeInvoke = vi.fn<
  (command: string, args?: InvokeArgs) => Promise<DiscoverPage>
>();

beforeEach(() => {
  nativeInvoke.mockReset().mockResolvedValue(firstPage);
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: { invoke: nativeInvoke },
  });
});

afterEach(() => {
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
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
    expect(nativeInvoke).toHaveBeenCalledWith(
      "discover",
      {
        input: {
          cursor: "*",
          sort: "new",
          tag: "ambient",
        },
      },
      undefined,
    );

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
