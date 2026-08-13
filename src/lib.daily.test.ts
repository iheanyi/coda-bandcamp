import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {},
  invoke: mocks.invoke,
}));

import { fetchDailyArticle, fetchDailyArticles } from "./lib";

describe("Bandcamp Daily native bridge", () => {
  beforeEach(() => {
    mocks.invoke.mockReset().mockResolvedValue({});
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
  });

  it("uses the native section argument for archive listings", async () => {
    await fetchDailyArticles("album-of-the-day", 2);

    expect(mocks.invoke).toHaveBeenCalledWith("daily_articles", {
      page: 2,
      section: "album-of-the-day",
    });
  });

  it("uses the article's real section when loading mixed genre results", async () => {
    await fetchDailyArticle("best-jazz", "patient-music");

    expect(mocks.invoke).toHaveBeenCalledWith("daily_article", {
      articleSection: "best-jazz",
      slug: "patient-music",
    });
  });
});
