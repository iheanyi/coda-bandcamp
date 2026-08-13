import { describe, expect, it } from "vitest";

import {
  dailyCategoryLabel,
  dailyArticlesNewestFirst,
  formatDailyDate,
  parseDailyArticleSection,
  dailyTracksFromEmbed,
  parseDailyArticleSlug,
  parseDailyCategory,
} from "./daily";
import type { DailyArticle } from "./types";

const article: DailyArticle = {
  articleUrl: "https://daily.bandcamp.com/lists/night-music",
  articleSection: "lists",
  embeds: [
    {
      artist: "Signal Garden",
      artistUrl: "https://signal-garden.bandcamp.com",
      id: "daily:lists:a42",
      itemUrl: "https://signal-garden.bandcamp.com/album/blue-hours",
      title: "Blue Hours",
      tracks: [
        {
          album: "Blue Hours",
          albumId: "daily:lists:a42",
          artist: "Signal Garden",
          duration: 181,
          id: "daily:lists:a42:7",
          streamUrl: "https://t4.bcbits.com/stream/signed",
          title: "First Light",
          track: 1,
        },
      ],
    },
  ],
  id: "daily:lists:night-music",
  slug: "night-music",
  title: "Night Music",
};

describe("Bandcamp Daily domain helpers", () => {
  it("recognizes the full Daily catalog and bounded article identities", () => {
    expect(parseDailyCategory("essential-releases")).toBe("essential-releases");
    expect(parseDailyCategory("genre-jazz")).toBe("genre-jazz");
    expect(parseDailyCategory("best-of-2026")).toBe("best-of-2026");
    expect(() => parseDailyCategory("latest")).toThrow(/category/u);
    expect(parseDailyArticleSection("left-behind-by-streaming")).toBe(
      "left-behind-by-streaming",
    );
    expect(parseDailyArticleSlug("night-music-2026")).toBe("night-music-2026");
    expect(() => parseDailyArticleSlug("../night-music")).toThrow(/slug/u);
    expect(() => parseDailyArticleSlug("-night-music")).toThrow(/slug/u);
    expect(() => parseDailyArticleSlug("night-music-")).toThrow(/slug/u);
    expect(dailyCategoryLabel("album-of-the-day")).toBe("Album of the Day");
  });

  it("keeps album order and attaches safe Daily provenance to playable tracks", () => {
    const tracks = dailyTracksFromEmbed(article, article.embeds[0]!);

    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({
      albumId: "daily:lists:a42",
      id: "daily:lists:a42:7",
      track: 1,
      dailySource: {
        articleSlug: "night-music",
        articleTitle: "Night Music",
        articleSection: "lists",
        itemUrl: "https://signal-garden.bandcamp.com/album/blue-hours",
      },
    });
    expect(tracks[0]?.palette).toHaveLength(2);
  });

  it("deduplicates and orders loaded stories newest-first with stable ties", () => {
    const summary = {
      articleSection: "lists",
      articleUrl: "https://daily.bandcamp.com/lists/story",
      id: "daily-article:lists:story",
      slug: "story",
      title: "Story",
    };
    expect(
      dailyArticlesNewestFirst([
        { ...summary, id: "missing", slug: "missing" },
        { ...summary, id: "same-a", publishedAt: "2026-08-11" },
        { ...summary, id: "newest", publishedAt: "2026-08-12" },
        { ...summary, id: "same-b", publishedAt: "2026-08-11" },
        { ...summary, id: "newest", publishedAt: "2026-08-12" },
      ]).map(({ id }) => id),
    ).toEqual(["newest", "same-a", "same-b", "missing"]);
  });

  it("formats date-only listing values without crossing calendar days", () => {
    expect(formatDailyDate("2026-08-07")).toMatch(/7/u);
  });
});
