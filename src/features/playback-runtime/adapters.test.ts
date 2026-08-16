import { describe, expect, it, vi } from "vitest";

import {
  dispatchSystemMediaControlEvent,
  parseSystemMediaControlEvent,
} from "./adapters";
import type { DesktopPlaybackControlHandlers } from "./types";

function controlHarness() {
  const onPlay = vi.fn();
  const onSeek = vi.fn();
  const handlers: DesktopPlaybackControlHandlers = {
    onPlay,
    onPause: vi.fn(),
    onTogglePlayback: vi.fn(),
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onSeek,
    onShuffleLibrary: vi.fn(),
  };
  return { handlers, onPlay, onSeek };
}

describe("desktop system-media event boundary", () => {
  it("forwards only a finite numeric seek position", () => {
    const { handlers, onSeek } = controlHarness();

    dispatchSystemMediaControlEvent(handlers, {
      action: "seek",
      positionSeconds: 42.5,
    });

    expect(onSeek).toHaveBeenCalledExactlyOnceWith(42.5);
  });

  it.each([
    ["numeric string", "42"],
    ["null", null],
    ["NaN", Number.NaN],
    ["positive infinity", Number.POSITIVE_INFINITY],
    ["negative infinity", Number.NEGATIVE_INFINITY],
    ["missing", undefined],
  ])("rejects a malformed %s seek position", (_label, positionSeconds) => {
    const { handlers, onSeek } = controlHarness();
    const payload = { action: "seek", positionSeconds };

    expect(parseSystemMediaControlEvent(payload)).toBeUndefined();
    dispatchSystemMediaControlEvent(handlers, payload);

    expect(onSeek).not.toHaveBeenCalled();
  });

  it("preserves valid non-seek controls", () => {
    const { handlers, onPlay } = controlHarness();

    dispatchSystemMediaControlEvent(handlers, { action: "play" });

    expect(onPlay).toHaveBeenCalledOnce();
  });
});
