import { describe, expect, it } from "vitest";
import {
  parseNativeDailyArticle,
  parseNativeDailyArticlesPage,
} from "./data-bridge/daily";

const articleSummary = {
  id: "best-jazz:patient-music",
  articleSection: "best-jazz",
  slug: "patient-music",
  title: "Patient Music",
  articleUrl: "https://daily.bandcamp.com/best-jazz/patient-music",
};

describe("Bandcamp Daily native decoders", () => {
  it("decodes the native section on bounded archive pages", () => {
    expect(parseNativeDailyArticlesPage({
      results: [articleSummary],
      page: 2,
      hasMore: true,
    })).toEqual({
      results: [articleSummary],
      page: 2,
      hasMore: true,
    });
  });

  it("decodes mixed-section articles and their playable embeds", () => {
    expect(parseNativeDailyArticle({
      ...articleSummary,
      embeds: [{
        id: "album-1",
        title: "Soft Focus",
        artist: "Night Archive",
        itemUrl: "https://nightarchive.bandcamp.com/album/soft-focus",
        tracks: [{
          id: "daily:track-1",
          title: "Afterimage",
          artist: "Night Archive",
          album: "Soft Focus",
          albumId: "album-1",
          duration: 245,
          track: 1,
          streamUrl: "https://t4.bcbits.com/stream/test/mp3-128",
        }],
      }],
    })).toMatchObject({
      articleSection: "best-jazz",
      embeds: [{
        tracks: [{
          id: "daily:track-1",
        }],
      }],
    });
  });

  it("rejects untrusted media URLs and oversized result lists", () => {
    const article = {
      ...articleSummary,
      embeds: [{
        id: "album-1",
        title: "Soft Focus",
        artist: "Night Archive",
        itemUrl: "https://nightarchive.bandcamp.com/album/soft-focus",
        tracks: [{
          id: "daily:track-1",
          title: "Afterimage",
          artist: "Night Archive",
          album: "Soft Focus",
          albumId: "album-1",
          duration: 245,
          track: 1,
          streamUrl: "https://example.com/track.mp3",
        }],
      }],
    };
    expect(() => parseNativeDailyArticle(article)).toThrow(
      "verified Bandcamp HTTPS URL",
    );
    expect(() => parseNativeDailyArticlesPage({
      results: Array.from({ length: 31 }, () => articleSummary),
      page: 1,
      hasMore: false,
    })).toThrow("at most 30 entries");
  });

  it("ignores inherited article fields and does not invoke accessors", () => {
    let getterCalls = 0;
    const accessorPage = {
      results: [articleSummary],
      page: 2,
      hasMore: true,
    };
    Object.defineProperty(accessorPage, "results", {
      configurable: true,
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("daily page getter must not run");
      },
    });
    Object.defineProperty(Object.prototype, "page", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: 2,
    });
    try {
      expect(() => parseNativeDailyArticlesPage({
        results: [articleSummary],
        hasMore: true,
      })).toThrow("Invalid native response for daily_articles.page");
      expect(() => parseNativeDailyArticlesPage(accessorPage)).toThrow(
        "Invalid native response for daily_articles.results",
      );
      expect(() => parseNativeDailyArticle([])).toThrow(
        "Invalid native response for daily_article",
      );
      expect(getterCalls).toBe(0);
    } finally {
      Reflect.deleteProperty(Object.prototype, "page");
    }
  });
});
