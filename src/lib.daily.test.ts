import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCodaDataBridge,
  fetchDailyArticle,
  fetchDailyArticles,
} from "./lib";

const mocks = {
  invoke: vi.fn(),
};
const bridge = createCodaDataBridge(mocks.invoke);

describe("Bandcamp Daily native bridge", () => {
  beforeEach(() => {
    mocks.invoke.mockReset().mockResolvedValue({});
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
  });

  it("uses the native section argument for archive listings", async () => {
    await fetchDailyArticles("album-of-the-day", 2, bridge);

    expect(mocks.invoke).toHaveBeenCalledWith("daily_articles", {
      page: 2,
      section: "album-of-the-day",
    });
  });

  it("uses the article's real section when loading mixed genre results", async () => {
    await fetchDailyArticle("best-jazz", "patient-music", bridge);

    expect(mocks.invoke).toHaveBeenCalledWith("daily_article", {
      articleSection: "best-jazz",
      slug: "patient-music",
    });
  });
});
