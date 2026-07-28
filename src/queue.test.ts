import { describe, expect, it } from "vitest";
import {
  activateTrack,
  appendUnique,
  keepCurrentTrack,
  moveItem,
  shuffled,
} from "./queue";
import type { Track } from "./types";

const track = (id: string) => ({ id }) as Track;

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
});
