import { describe, expect, it, vi } from "vitest";
import {
  createPlaybackClock,
  MAX_PLAYBACK_POSITION_SECONDS,
} from "./playbackClock";

describe("playback clock", () => {
  it("keeps the exact media position while publishing at most once per second", () => {
    const clock = createPlaybackClock();
    const listener = vi.fn();
    clock.subscribe(listener);

    clock.updateFromMedia(0.25);
    clock.updateFromMedia(0.99);

    expect(clock.readExact()).toBe(0.99);
    expect(clock.getSnapshot()).toBe(0);
    expect(listener).not.toHaveBeenCalled();

    clock.updateFromMedia(1.01);
    expect(clock.readExact()).toBe(1.01);
    expect(clock.getSnapshot()).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);

    clock.updateFromMedia(1.95);
    expect(clock.readExact()).toBe(1.95);
    expect(clock.getSnapshot()).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);

    clock.updateFromMedia(3.4);
    expect(clock.readExact()).toBe(3.4);
    expect(clock.getSnapshot()).toBe(3);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("publishes seeks immediately without snapping backward in the same second", () => {
    const clock = createPlaybackClock();
    const listener = vi.fn();
    clock.subscribe(listener);

    clock.seek(12.25);
    expect(clock.readExact()).toBe(12.25);
    expect(clock.getSnapshot()).toBe(12.25);
    expect(listener).toHaveBeenCalledTimes(1);

    clock.updateFromMedia(12.9);
    expect(clock.readExact()).toBe(12.9);
    expect(clock.getSnapshot()).toBe(12.25);
    expect(listener).toHaveBeenCalledTimes(1);

    clock.seek(12.75);
    expect(clock.getSnapshot()).toBe(12.75);
    expect(listener).toHaveBeenCalledTimes(2);

    clock.updateFromMedia(13.02);
    expect(clock.getSnapshot()).toBe(13);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("publishes restored positions and resets immediately", () => {
    const clock = createPlaybackClock(20);
    const snapshots: number[] = [];
    clock.subscribe(() => snapshots.push(clock.getSnapshot()));

    clock.restore(42.5);
    clock.reset();

    expect(snapshots).toEqual([42.5, 0]);
    expect(clock.readExact()).toBe(0);
    expect(clock.getSnapshot()).toBe(0);

    clock.reset();
    expect(snapshots).toEqual([42.5, 0]);
  });

  it("normalizes invalid, negative, and overlong positions", () => {
    const clock = createPlaybackClock(-10);

    expect(clock.readExact()).toBe(0);
    expect(clock.getSnapshot()).toBe(0);

    clock.seek(MAX_PLAYBACK_POSITION_SECONDS + 100);
    expect(clock.readExact()).toBe(MAX_PLAYBACK_POSITION_SECONDS);
    expect(clock.getSnapshot()).toBe(MAX_PLAYBACK_POSITION_SECONDS);

    clock.restore(Number.NaN);
    expect(clock.readExact()).toBe(0);
    expect(clock.getSnapshot()).toBe(0);

    clock.seek(Number.POSITIVE_INFINITY);
    expect(clock.readExact()).toBe(0);
    expect(clock.getSnapshot()).toBe(0);

    clock.updateFromMedia(-2);
    expect(clock.readExact()).toBe(0);
    expect(clock.getSnapshot()).toBe(0);
  });

  it("stops notifying an unsubscribed listener", () => {
    const clock = createPlaybackClock();
    const listener = vi.fn();
    const unsubscribe = clock.subscribe(listener);

    clock.updateFromMedia(1.1);
    unsubscribe();
    clock.updateFromMedia(2.1);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps clock instances isolated", () => {
    const first = createPlaybackClock(4);
    const second = createPlaybackClock(40);
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    first.subscribe(firstListener);
    second.subscribe(secondListener);

    first.seek(8.5);

    expect(first.readExact()).toBe(8.5);
    expect(first.getSnapshot()).toBe(8.5);
    expect(second.readExact()).toBe(40);
    expect(second.getSnapshot()).toBe(40);
    expect(firstListener).toHaveBeenCalledOnce();
    expect(secondListener).not.toHaveBeenCalled();
  });
});
