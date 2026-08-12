import { renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { useDiscoverRuntimeAdapter } from "./useDiscoverRuntimeAdapter";

it("projects Discover navigation and playback with stable leaf dependencies", () => {
  const navigation = {
    onCloseRelease: vi.fn(),
    onOpenArtist: vi.fn(),
    onOpenRelease: vi.fn(),
  };
  const playbackActions = {
    onPlay: vi.fn(),
    onQueue: vi.fn(),
    onTogglePlayback: vi.fn(),
  };
  const { result, rerender } = renderHook(
    ({ currentTrackId }: { currentTrackId?: string }) =>
      useDiscoverRuntimeAdapter({
        navigation: { ...navigation },
        playback: {
          currentTrackId,
          ...playbackActions,
          playing: true,
        },
      }),
    { initialProps: { currentTrackId: "track-1" } },
  );
  const initial = result.current;

  rerender({ currentTrackId: "track-1" });
  expect(result.current).toBe(initial);
  expect(result.current).toMatchObject({
    currentTrackId: "track-1",
    playing: true,
    ...navigation,
    ...playbackActions,
  });
});
