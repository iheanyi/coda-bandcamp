import { useMemo } from "react";

import type { DiscoverRuntimeValue } from "./DiscoverRuntimeContext";

export type DiscoverPlaybackRuntime = Pick<
  DiscoverRuntimeValue,
  "currentTrackId" | "onPlay" | "onQueue" | "onTogglePlayback" | "playing"
>;

export type DiscoverNavigationRuntime = Pick<
  DiscoverRuntimeValue,
  "onCloseRelease" | "onOpenArtist" | "onOpenRelease"
>;

export type DiscoverRuntimeAdapterOptions = Readonly<{
  navigation: DiscoverNavigationRuntime;
  playback: DiscoverPlaybackRuntime;
}>;

/** Projects shell playback and navigation commands into the Discover route seam. */
export function useDiscoverRuntimeAdapter({
  navigation,
  playback,
}: DiscoverRuntimeAdapterOptions): DiscoverRuntimeValue {
  const { onCloseRelease, onOpenArtist, onOpenRelease } = navigation;
  const { currentTrackId, onPlay, onQueue, onTogglePlayback, playing } =
    playback;

  return useMemo(
    () => ({
      currentTrackId,
      onCloseRelease,
      onOpenArtist,
      onOpenRelease,
      onPlay,
      onQueue,
      onTogglePlayback,
      playing,
    }),
    [
      currentTrackId,
      onCloseRelease,
      onOpenArtist,
      onOpenRelease,
      onPlay,
      onQueue,
      onTogglePlayback,
      playing,
    ],
  );
}
