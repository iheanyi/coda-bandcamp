import { describe, expect, it } from "vitest";
import {
  createProgressiveShuffleMaterialization,
  createProgressiveShufflePlan,
  materializeProgressiveShuffleTracks,
  recordProgressiveShuffleSourceResult,
  resolveProgressiveShuffleAdvance,
  shouldFlushProgressiveShuffleTracks,
  shuffleProgressiveAlbumTracks,
  takeProgressiveShuffleTracks,
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

describe("progressive shuffle materialization", () => {
  const policy = { maxTracks: 64, minTracks: 4, maxWaitMs: 1_500 };
  const singles = Array.from({ length: 5 }, (_, index) => ({
    id: `single-${index}`,
    songCount: 1,
  }));

  it("holds out-of-order results behind the deterministic source boundary", () => {
    const state = createProgressiveShuffleMaterialization<
      (typeof singles)[number],
      { id: string }
    >({ seed: 7, slots: singles.slice(0, 2) });
    recordProgressiveShuffleSourceResult(state, singles[1].id, [{ id: "two" }]);

    expect(materializeProgressiveShuffleTracks(state, 25_000, 0)).toBe(0);
    recordProgressiveShuffleSourceResult(state, singles[0].id, [{ id: "one" }]);

    expect(materializeProgressiveShuffleTracks(state, 25_000, 10)).toBe(2);
    expect(state.bufferedTracks.map((track) => track.id)).toEqual(["one", "two"]);
    expect(state.exhausted).toBe(true);
  });

  it("skips failed sources and deduplicates their playable successors", () => {
    const state = createProgressiveShuffleMaterialization<
      (typeof singles)[number],
      { id: string }
    >({ seed: 9, slots: singles.slice(0, 3) });
    recordProgressiveShuffleSourceResult(state, singles[0].id, []);
    recordProgressiveShuffleSourceResult(state, singles[1].id, [{ id: "shared" }]);
    recordProgressiveShuffleSourceResult(state, singles[2].id, [{ id: "shared" }]);

    expect(materializeProgressiveShuffleTracks(state, 25_000, 0)).toBe(1);
    expect(state.bufferedTracks).toEqual([{ id: "shared" }]);
    expect(state.exhausted).toBe(true);
  });

  it("stops materializing at the caller's persisted-queue bound", () => {
    const state = createProgressiveShuffleMaterialization<
      (typeof singles)[number],
      { id: string }
    >({ seed: 10, slots: singles.slice(0, 3) });
    for (let index = 0; index < 3; index += 1) {
      recordProgressiveShuffleSourceResult(
        state,
        singles[index].id,
        [{ id: `bounded-${index}` }],
      );
    }

    expect(materializeProgressiveShuffleTracks(state, 2, 0)).toBe(2);
    expect(state.bufferedTracks.map((track) => track.id)).toEqual([
      "bounded-0",
      "bounded-1",
    ]);
    expect(state.exhausted).toBe(true);
  });

  it("batches cold single-track arrivals into one structural queue commit", () => {
    const state = createProgressiveShuffleMaterialization<
      (typeof singles)[number],
      { id: string }
    >({ seed: 11, slots: singles });
    let commits = 0;
    const committed: string[] = [];

    for (let index = 0; index < 4; index += 1) {
      const now = index * 500;
      recordProgressiveShuffleSourceResult(
        state,
        singles[index].id,
        [{ id: `track-${index}` }],
      );
      materializeProgressiveShuffleTracks(state, 25_000, now, policy.maxTracks);
      if (shouldFlushProgressiveShuffleTracks(state, policy, {
        now,
        started: true,
        advancePending: false,
      })) {
        commits += 1;
        committed.push(
          ...takeProgressiveShuffleTracks(state, policy.maxTracks, now)
            .map((track) => track.id),
        );
      }
    }

    expect(commits).toBe(1);
    expect(committed).toEqual(["track-0", "track-1", "track-2", "track-3"]);
  });

  it("flushes startup and pending advances immediately, with a bounded tail wait", () => {
    const startup = createProgressiveShuffleMaterialization<
      (typeof singles)[number],
      { id: string }
    >({ seed: 13, slots: singles.slice(0, 1) });
    recordProgressiveShuffleSourceResult(startup, singles[0].id, [{ id: "first" }]);
    materializeProgressiveShuffleTracks(startup, 25_000, 0);

    expect(shouldFlushProgressiveShuffleTracks(startup, policy, {
      now: 0,
      started: false,
      advancePending: false,
    })).toBe(true);

    const tail = createProgressiveShuffleMaterialization<
      (typeof singles)[number],
      { id: string }
    >({ seed: 17, slots: singles.slice(0, 2) });
    recordProgressiveShuffleSourceResult(tail, singles[0].id, [{ id: "next" }]);
    materializeProgressiveShuffleTracks(tail, 25_000, 100);

    expect(shouldFlushProgressiveShuffleTracks(tail, policy, {
      now: 1_599,
      started: true,
      advancePending: false,
    })).toBe(false);
    expect(shouldFlushProgressiveShuffleTracks(tail, policy, {
      now: 1_600,
      started: true,
      advancePending: false,
    })).toBe(true);
    expect(shouldFlushProgressiveShuffleTracks(tail, policy, {
      now: 100,
      started: true,
      advancePending: true,
    })).toBe(true);
  });
});

describe("resolveProgressiveShuffleAdvance", () => {
  const queue = [{ id: "one" }, { id: "two" }, { id: "three" }];

  it("wraps a deferred manual Next after an empty exhausted tail", () => {
    expect(resolveProgressiveShuffleAdvance(
      queue,
      2,
      {
        currentIndex: 2,
        trackId: "three",
        reason: "next",
        wasPlaying: true,
      },
      "all",
      true,
    )).toEqual({ status: "resolved", currentIndex: 0, playing: true });
  });

  it("keeps a deferred manual Next paused when its track arrives", () => {
    expect(resolveProgressiveShuffleAdvance(
      queue.slice(0, 2),
      0,
      {
        currentIndex: 0,
        trackId: "one",
        reason: "next",
        wasPlaying: false,
      },
      "off",
      false,
    )).toEqual({ status: "resolved", currentIndex: 1, playing: false });
  });

  it("stops a naturally ended queue when the empty tail exhausts", () => {
    expect(resolveProgressiveShuffleAdvance(
      queue.slice(0, 1),
      0,
      {
        currentIndex: 0,
        trackId: "one",
        reason: "ended",
        wasPlaying: true,
      },
      "off",
      true,
    )).toEqual({ status: "resolved", currentIndex: 0, playing: false });
  });
});
