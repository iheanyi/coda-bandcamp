import { describe, expect, it } from "vitest";
import {
  createProgressiveShufflePlan,
  shuffleProgressiveAlbumTracks,
} from "./progressiveShuffle";

const sources = [
  { id: "album-a", songCount: 3 },
  { id: "album-b", songCount: 2 },
  { id: "album-c", songCount: 1 },
];

describe("createProgressiveShufflePlan", () => {
  it("creates one weighted slot per advertised song without replacement", () => {
    const plan = createProgressiveShufflePlan(sources, 25_000, () => 0.25);
    const counts = new Map<string, number>();
    for (const source of plan.slots) {
      counts.set(source.id, (counts.get(source.id) ?? 0) + 1);
    }

    expect(plan.slots).toHaveLength(6);
    expect(counts).toEqual(new Map([
      ["album-a", 3],
      ["album-b", 2],
      ["album-c", 1],
    ]));
  });

  it("is deterministic and bounded without expanding the full advertised catalog", () => {
    const oversized = sources.map((source) => ({
      ...source,
      songCount: 25_000,
    }));
    const first = createProgressiveShufflePlan(oversized, 17, () => 0.75);
    const second = createProgressiveShufflePlan(oversized, 17, () => 0.75);

    expect(first).toEqual(second);
    expect(first.slots).toHaveLength(17);
  });

  it("includes every one-track source exactly once", () => {
    const singles = Array.from({ length: 20 }, (_, index) => ({
      id: `single-${index}`,
      songCount: 1,
    }));
    const plan = createProgressiveShufflePlan(singles, 25_000, () => 0.5);

    expect(plan.slots).toHaveLength(singles.length);
    expect(new Set(plan.slots.map((source) => source.id)).size).toBe(
      singles.length,
    );
  });

  it("uses a stable per-album track order independent of hydration order", () => {
    const tracks = ["one", "two", "three", "four"];
    const firstA = shuffleProgressiveAlbumTracks(tracks, 1234, "album-a");
    const albumB = shuffleProgressiveAlbumTracks(tracks, 1234, "album-b");
    const secondA = shuffleProgressiveAlbumTracks(tracks, 1234, "album-a");

    expect(secondA).toEqual(firstA);
    expect(albumB).not.toEqual(firstA);
    expect(firstA).toEqual(expect.arrayContaining(tracks));
  });
});
