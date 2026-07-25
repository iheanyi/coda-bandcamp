import { describe, expect, it, vi } from "vitest";
import { showAirPlayPicker, supportsAirPlayPicker } from "./media";

describe("AirPlay capability detection", () => {
  it("uses the native WebKit playback target picker when available", () => {
    const picker = vi.fn();
    const media = { webkitShowPlaybackTargetPicker: picker } as unknown as HTMLAudioElement;
    expect(supportsAirPlayPicker(media)).toBe(true);
    expect(showAirPlayPicker(media)).toBe(true);
    expect(picker).toHaveBeenCalledOnce();
  });

  it("stays hidden on platforms without a native picker", () => {
    const media = {} as HTMLAudioElement;
    expect(supportsAirPlayPicker(media)).toBe(false);
    expect(showAirPlayPicker(media)).toBe(false);
  });
});
