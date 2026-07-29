import { describe, expect, it } from "vitest";
import { recommendQueueAlbum } from "./queueRecommendation";
import type { Album, Track } from "./types";

const album = (
  id: string,
  artist: string,
  genre: string,
  songCount = 8,
): Album => ({
  id,
  title: `Album ${id}`,
  artist,
  genre,
  songCount,
  duration: songCount * 180,
  palette: ["#111", "#222"],
});

const seed: Track = {
  id: "track-seed",
  title: "Seed",
  artist: "Artist A",
  album: "Album seed",
  albumId: "seed",
  duration: 180,
  track: 1,
  palette: ["#111", "#222"],
};

describe("queue recommendations", () => {
  it("excludes the current release and weights related owned albums without fetching metadata", () => {
    const result = recommendQueueAlbum(
      [
        album("seed", "Artist A", "Electronic"),
        album("related", "Artist B", "Electronic"),
      ],
      seed,
      new Set(),
    );

    expect(result).toMatchObject({
      album: { id: "related" },
      reason: "Another Electronic pick",
    });
  });

  it("returns a collection wildcard without a playback seed", () => {
    const result = recommendQueueAlbum(
      [album("only", "Artist A", "Jazz")],
      undefined,
      new Set(),
      2,
    );

    expect(result).toMatchObject({
      album: { id: "only" },
      reason: "A wildcard from your collection",
    });
  });
});
