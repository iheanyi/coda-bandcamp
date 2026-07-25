import { describe, expect, it } from "vitest";
import { genreKey, normalizeGenre, summarizeGenres } from "./genres";

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
