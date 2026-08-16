import { QueryClient } from "@tanstack/react-query";
import type { InvokeArgs } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DailyArticle, DailyArticlesPage } from "@/types";

import {
  dailyArticleQueryOptions,
  dailyArticlesInfiniteQueryOptions,
} from "./dailyQueries";

type DailyBridgeResult = DailyArticle | DailyArticlesPage;

const nativeInvoke = vi.fn<
  (command: string, args?: InvokeArgs) => Promise<DailyBridgeResult>
>();

beforeEach(() => {
  nativeInvoke.mockReset();
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: { invoke: nativeInvoke },
  });
});

afterEach(() => {
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});

describe("Bandcamp Daily queries", () => {
  it("keys paginated category feeds independently", async () => {
    const page: DailyArticlesPage = {
      hasMore: true,
      page: 1,
      results: [],
    };
    nativeInvoke.mockResolvedValue(page);
    const options = dailyArticlesInfiniteQueryOptions("features");
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    expect(options.queryKey).toEqual(["bandcamp-daily", "features"]);
    await queryClient.fetchInfiniteQuery(options);
    expect(nativeInvoke).toHaveBeenCalledWith("daily_articles", {
      page: 1,
      section: "features",
    }, undefined);
    expect(
      options.getNextPageParam?.(page, [page], 1, [1]),
    ).toBe(2);
  });

  it("loads article music separately from signed-stream-free feed summaries", async () => {
    const article: DailyArticle = {
      articleSection: "lists",
      articleUrl: "https://daily.bandcamp.com/lists/night-music",
      embeds: [],
      id: "daily-article-1",
      slug: "night-music",
      title: "Night Music",
    };
    nativeInvoke.mockResolvedValue(article);
    const options = dailyArticleQueryOptions("lists", "night-music");
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    expect(options.queryKey).toEqual([
      "bandcamp-daily-article",
      "lists",
      "night-music",
    ]);
    await queryClient.fetchQuery(options);
    expect(nativeInvoke).toHaveBeenCalledWith("daily_article", {
      articleSection: "lists",
      slug: "night-music",
    }, undefined);
  });
});
