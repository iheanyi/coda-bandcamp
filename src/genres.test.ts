import { describe, expect, it } from "vitest";
import {
  DISCOVER_GENRES,
  genreKey,
  normalizeGenre,
  summarizeGenres,
} from "./genres";

describe("genre support", () => {
  it("normalizes whitespace, casing, and common music abbreviations", () => {
    expect(normalizeGenre("  r&b/SOUL ")).toBe("R&B/Soul");
    expect(normalizeGenre("HIP HOP/RAP")).toBe("Hip-Hop/Rap");
    expect(normalizeGenre("ambient   dub")).toBe("Ambient Dub");
    expect(normalizeGenre("   ")).toBeUndefined();
  });

  it("compares genres without case or spacing differences", () => {
    expect(genreKey(" Ambient  Dub ")).toBe("ambient dub");
  });

  it("uses Bandcamp's canonical normalized tags for every Discover genre", () => {
    expect(DISCOVER_GENRES).toEqual([
      "electronic",
      "rock",
      "metal",
      "alternative",
      "hip-hop-rap",
      "experimental",
      "punk",
      "folk",
      "pop",
      "ambient",
      "soundtrack",
      "world",
      "jazz",
      "acoustic",
      "funk",
      "r-b-soul",
      "devotional",
      "classical",
      "reggae",
      "podcasts",
      "country",
      "spoken-word",
      "comedy",
      "blues",
      "kids",
      "audiobooks",
      "latin",
    ]);
    expect(DISCOVER_GENRES.every((tag) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tag))).toBe(true);
    expect(normalizeGenre("hip-hop-rap")).toBe("Hip-Hop/Rap");
    expect(normalizeGenre("r-b-soul")).toBe("R&B/Soul");
    expect(normalizeGenre("spoken-word")).toBe("Spoken Word");
  });

  it("ranks frequent genres while retaining the complete alphabetical list", () => {
    const summary = summarizeGenres([
      { genre: "rock" },
      { genre: "ROCK" },
      { genre: "ambient" },
      { genre: "jazz" },
    ], 2);
    expect(summary.featured).toEqual(["Rock", "Ambient"]);
    expect(summary.all).toEqual(["Ambient", "Jazz", "Rock"]);
  });
});
