import { describe, expect, it, vi } from "vitest";

import {
  dispatchSystemMediaControlEvent,
  parseSystemMediaControlEvent,
} from "./adapters";
import type { DesktopPlaybackControlHandlers } from "./types";

function controlHarness() {
  const onPlay = vi.fn();
  const onPause = vi.fn();
  const onPrevious = vi.fn();
  const onNext = vi.fn();
  const onSeek = vi.fn();
  const handlers: DesktopPlaybackControlHandlers = {
    onPlay,
    onPause,
    onTogglePlayback: vi.fn(),
    onPrevious,
    onNext,
    onSeek,
    onShuffleLibrary: vi.fn(),
  };
  return { handlers, onPlay, onPause, onPrevious, onNext, onSeek };
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

  it.each([
    ["play", "onPlay"],
    ["pause", "onPause"],
    ["previous", "onPrevious"],
    ["next", "onNext"],
  ] as const)("dispatches the %s control", (action, callbackName) => {
    const harness = controlHarness();

    dispatchSystemMediaControlEvent(harness.handlers, { action });

    expect(harness[callbackName]).toHaveBeenCalledOnce();
  });

  it("rejects collection payloads that spoof plain event records", () => {
    const { handlers, onPlay } = controlHarness();
    const payload = Object.assign([], {
      action: "play",
      [Symbol.toStringTag]: "Object",
    });

    expect(parseSystemMediaControlEvent(payload)).toBeUndefined();
    dispatchSystemMediaControlEvent(handlers, payload);

    expect(onPlay).not.toHaveBeenCalled();
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a primitive", "play"],
    ["an empty record", {}],
    ["a missing discriminant", { positionSeconds: 12 }],
    ["a null discriminant", { action: null }],
    ["a boxed discriminant", { action: new String("play") }],
    ["an unknown discriminant", { action: "play-pause" }],
  ])("rejects %s as a malformed event payload", (_label, payload) => {
    expect(parseSystemMediaControlEvent(payload)).toBeUndefined();
  });

  it("rejects inherited and accessor-backed spoofed discriminants", () => {
    const inheritedPayload = Object.create({ action: "play" });
    const actionGetter = vi.fn(() => "play");
    const accessorPayload = Object.defineProperty({}, "action", {
      get: actionGetter,
    });

    expect(parseSystemMediaControlEvent(inheritedPayload)).toBeUndefined();
    expect(parseSystemMediaControlEvent(accessorPayload)).toBeUndefined();
    expect(actionGetter).not.toHaveBeenCalled();
  });

  it("rejects a spoofed numeric object as a seek position", () => {
    const positionSeconds = {
      [Symbol.toStringTag]: "Number",
      valueOf: () => 42,
    };

    expect(
      parseSystemMediaControlEvent({ action: "seek", positionSeconds }),
    ).toBeUndefined();
  });
});
