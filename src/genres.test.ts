import { describe, expect, it } from "vitest";
import {
  DISCOVER_GENRES,
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

  it("uses Bandcamp's canonical normalized tags for every Discover genre", () => {
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
