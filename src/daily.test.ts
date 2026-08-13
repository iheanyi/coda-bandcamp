import { describe, expect, it } from "vitest";

import {
  dailyCategoryLabel,
  dailyTracksFromEmbed,
  parseDailyArticleSlug,
  parseDailyCategory,
} from "./daily";
import type { DailyArticle } from "./types";

const article: DailyArticle = {
  articleUrl: "https://daily.bandcamp.com/lists/night-music",
  category: "lists",
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
  it("recognizes only the six supported Daily categories and bounded slugs", () => {
    expect(parseDailyCategory("essential-releases")).toBe("essential-releases");
    expect(() => parseDailyCategory("latest")).toThrow(/category/u);
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
        category: "lists",
        itemUrl: "https://signal-garden.bandcamp.com/album/blue-hours",
      },
    });
    expect(tracks[0]?.palette).toHaveLength(2);
  });
});
