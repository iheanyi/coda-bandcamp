import { describe, expect, it } from "vitest";
import { pickRandomItem, pickWeightedItem } from "./random";

describe("random selection helpers", () => {
  it("selects an item deterministically without exceeding array bounds", () => {
    expect(pickRandomItem(["a", "b", "c"], () => 0)).toBe("a");
    expect(pickRandomItem(["a", "b", "c"], () => 0.999)).toBe("c");
    expect(pickRandomItem(["a", "b", "c"], () => 1)).toBe("c");
    expect(pickRandomItem([], () => 0.5)).toBeUndefined();
  });

  it("weights releases by their number of tracks", () => {
    const releases = [
      { title: "Single", songs: 1 },
      { title: "Album", songs: 3 },
    ];

    expect(pickWeightedItem(releases, (release) => release.songs, () => 0.1)?.title).toBe("Single");
    expect(pickWeightedItem(releases, (release) => release.songs, () => 0.75)?.title).toBe("Album");
  });

  it("falls back to an unweighted pick when every weight is zero", () => {
    expect(pickWeightedItem(["a", "b"], () => 0, () => 0.75)).toBe("b");
  });
});
