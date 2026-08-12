import { describe, expect, it, vi } from "vitest";
import {
  pickRandomItem,
  pickWeightedItem,
  weightedRandomOrder,
  yieldToMacrotask,
} from "./random";

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

  it("builds a deterministic weighted order without mutating the input", () => {
    const releases = [
      { title: "Single", songs: 1 },
      { title: "Album", songs: 3 },
      { title: "EP", songs: 2 },
    ];
    const randomValues = [0.9, 0.2, 0.6];
    const random = vi.fn(() => randomValues.shift() ?? 0);
    const weightFor = vi.fn((release: (typeof releases)[number]) =>
      release.songs
    );

    expect(weightedRandomOrder(releases, weightFor, random).map(
      (release) => release.title,
    )).toEqual(["Album", "EP", "Single"]);
    expect(releases.map((release) => release.title)).toEqual([
      "Single",
      "Album",
      "EP",
    ]);
    expect(weightFor).toHaveBeenCalledTimes(releases.length);
    expect(random).toHaveBeenCalledTimes(releases.length);
  });

  it("orders positive weights before a shuffled zero-weight fallback", () => {
    const randomValues = [0.8, 0.2, 0.9];

    expect(weightedRandomOrder(
      [
        { id: "zero-a", weight: 0 },
        { id: "heavy", weight: 2 },
        { id: "zero-b", weight: Number.NaN },
        { id: "light", weight: 1 },
      ],
      (item) => item.weight,
      () => randomValues.shift() ?? 0,
    ).map((item) => item.id)).toEqual([
      "light",
      "heavy",
      "zero-b",
      "zero-a",
    ]);
  });

  it("yields through a timer macrotask", async () => {
    vi.useFakeTimers();
    try {
      let resolved = false;
      const pending = yieldToMacrotask().then(() => {
        resolved = true;
      });

      await Promise.resolve();
      expect(resolved).toBe(false);
      await vi.runAllTimersAsync();
      await pending;
      expect(resolved).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
