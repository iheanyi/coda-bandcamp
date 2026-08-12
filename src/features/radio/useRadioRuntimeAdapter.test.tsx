import { renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { createPlaybackClock } from "@/playbackClock";

import { useRadioRuntimeAdapter } from "./useRadioRuntimeAdapter";

it("projects device-local Radio favorites without copying playback state", () => {
  const favoriteRadioShowIds = new Set([42]);
  const toggleRadioFavorite = vi.fn();
  const playbackClock = createPlaybackClock();
  const playback = {
    currentTrackId: "radio:42",
    onPlay: vi.fn(),
    onPlayAt: vi.fn(),
    onQueue: vi.fn(),
    onTogglePlayback: vi.fn(),
    playbackClock,
    playing: true,
  };
  const { result } = renderHook(() =>
    useRadioRuntimeAdapter({
      favorites: { favoriteRadioShowIds, toggleRadioFavorite },
      playback,
    }),
  );

  expect(result.current.favoriteShowIds).toBe(favoriteRadioShowIds);
  expect(result.current.playbackClock).toBe(playbackClock);
  expect(result.current.currentTrackId).toBe("radio:42");
  expect(result.current.onToggleFavorite).toBe(toggleRadioFavorite);
});
