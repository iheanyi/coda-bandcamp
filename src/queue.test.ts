import { describe, expect, it } from "vitest";
import {
  activateTrack,
  appendUnique,
  keepCurrentTrack,
  moveItem,
  shuffled,
} from "./queue";
import type { Track } from "./types";

const track = (id: string): Track => ({
  id,
  title: id,
  artist: "Queue test artist",
  album: "Queue test album",
  albumId: `album-${id}`,
  duration: 180,
  track: 1,
  palette: ["#111111", "#222222"],
});

describe("queue helpers", () => {
  it("appends tracks without introducing duplicate ids", () => {
    expect(appendUnique([track("a")], [track("a"), track("b")]).map((item) => item.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("moves a queue item without mutating the source", () => {
    const source = ["a", "b", "c"];
    expect(moveItem(source, 0, 2)).toEqual(["b", "c", "a"]);
    expect(source).toEqual(["a", "b", "c"]);
  });

  it("clears upcoming tracks while preserving the current track", () => {
    const queue = [track("played"), track("current"), track("next")];
    expect(keepCurrentTrack(queue, 1).map((item) => item.id)).toEqual(["current"]);
    expect(queue.map((item) => item.id)).toEqual(["played", "current", "next"]);
  });

  it("inserts a new track after the current item and activates it", () => {
    const queue = [track("current"), track("later")];
    const result = activateTrack(queue, 0, track("recommended"));

    expect(result.queue.map((item) => item.id)).toEqual([
      "current",
      "recommended",
      "later",
    ]);
    expect(result.currentIndex).toBe(1);
    expect(queue.map((item) => item.id)).toEqual(["current", "later"]);
  });

  it("activates an existing queued track without duplicating it", () => {
    const queue = [track("current"), track("recommended")];
    const result = activateTrack(queue, 0, queue[1]);

    expect(result).toEqual({ queue, currentIndex: 1 });
  });

  it("supports deterministic shuffling", () => {
    expect(shuffled(["a", "b", "c"], () => 0)).toEqual(["b", "c", "a"]);
  });

  it("preserves queue invariants across deterministic randomized operations", () => {
    let randomState = 0xc0da0400;
    const random = () => {
      randomState = (randomState * 1_664_525 + 1_013_904_223) >>> 0;
      return randomState / 0x1_0000_0000;
    };

    for (let run = 0; run < 2_000; run += 1) {
      const length = 1 + Math.floor(random() * 80);
      const source = Array.from({ length }, (_, index) => `item-${index}`);
      const from = Math.floor(random() * length);
      const to = Math.floor(random() * length);
      const moved = moveItem(source, from, to);
      expect(source).toEqual(
        Array.from({ length }, (_, index) => `item-${index}`),
      );
      expect([...moved].sort()).toEqual([...source].sort());
      expect(moved[to]).toBe(source[from]);

      const shuffledItems = shuffled(source, random);
      expect(source).toEqual(
        Array.from({ length }, (_, index) => `item-${index}`),
      );
      expect([...shuffledItems].sort()).toEqual([...source].sort());

      const queue = source.slice(0, Math.floor(length / 2)).map(track);
      const additions = source
        .slice(Math.floor(length / 3))
        .concat(source.slice(-3))
        .map(track);
      const appended = appendUnique(queue, additions);
      expect(new Set(appended.map((item) => item.id)).size).toBe(
        appended.length,
      );
      expect(appended.slice(0, queue.length)).toEqual(queue);

      const newTrack = track(`new-${run}`);
      const currentIndex = Math.floor(random() * queue.length);
      const activated = activateTrack(queue, currentIndex, newTrack);
      expect(activated.queue[activated.currentIndex]).toBe(newTrack);
      expect(activated.currentIndex).toBe(
        Math.min(currentIndex + 1, queue.length),
      );
      expect(queue).not.toContain(newTrack);
    }
  });
});
