import { afterEach, describe, expect, it, vi } from "vitest";
import { createPlayerStateAsync } from "./playerState";
import {
  PlayerStatePreparationClient,
  waitForPlayerStateIdle,
} from "./playerStatePreparation";
import type { PlayerStateInput, PlayerStateTrack } from "./types";

const track: PlayerStateTrack = {
  id: "track-1",
  title: "Afterimage",
  artist: "Night Archive",
  album: "Soft Focus",
  albumId: "album-1",
  duration: 240,
  track: 1,
  palette: ["#cf6046", "#2f2624"],
};

const input: PlayerStateInput = {
  queue: [track],
  currentIndex: 0,
  positionSeconds: 30,
  volume: 0.8,
  repeatMode: "off",
  queueOpen: false,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("player-state idle preparation", () => {
  it("does not begin preparation until the scheduled idle window runs", async () => {
    let runIdle: (() => void) | undefined;
    const schedule = vi.fn((callback: () => void) => {
      runIdle = callback;
    });
    const prepareState = vi.fn(createPlayerStateAsync);
    const client = new PlayerStatePreparationClient(schedule, prepareState);

    const prepared = client.prepare(input, 1_000);
    await Promise.resolve();

    expect(schedule).toHaveBeenCalledTimes(1);
    expect(prepareState).not.toHaveBeenCalled();

    runIdle?.();
    await expect(prepared).resolves.toMatchObject({ savedAt: 1_000 });
    expect(prepareState).toHaveBeenCalledWith(input, 1_000);
  });

  it("uses requestIdleCallback with a bounded timeout", async () => {
    let runIdle: IdleRequestCallback | undefined;
    const requestIdle = vi.fn((callback: IdleRequestCallback) => {
      runIdle = callback;
      return 7;
    });
    vi.stubGlobal("requestIdleCallback", requestIdle);

    const waiting = waitForPlayerStateIdle();
    let settled = false;
    void waiting.then(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(requestIdle).toHaveBeenCalledWith(expect.any(Function), { timeout: 250 });

    runIdle?.({ didTimeout: false, timeRemaining: () => 10 });
    await waiting;
    expect(settled).toBe(true);
  });

  it("falls back to a real task boundary when idle callbacks are unavailable", async () => {
    vi.stubGlobal("requestIdleCallback", undefined);

    const waiting = waitForPlayerStateIdle();
    let settled = false;
    void waiting.then(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(settled).toBe(false);
    await waiting;
    expect(settled).toBe(true);
  });

  it("ignores a truthy value spoofing the idle callback boundary", async () => {
    vi.stubGlobal("requestIdleCallback", {
      [Symbol.toStringTag]: "Function",
    });

    await expect(waitForPlayerStateIdle()).resolves.toBeUndefined();
  });

  it("preserves validation errors after the idle boundary", async () => {
    const client = new PlayerStatePreparationClient((callback) => callback());

    await expect(
      client.prepare({ ...input, currentIndex: 4 }, 2_000),
    ).rejects.toThrow("The player state is invalid and was not saved.");
  });
});
