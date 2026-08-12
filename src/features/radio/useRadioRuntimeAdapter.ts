import { useMemo } from "react";

import type { LocalFavoritesController } from "@/features/favorites/useLocalFavoritesController";

import type { RadioRuntimeValue } from "./RadioRuntimeContext";

export type RadioPlaybackRuntime = Pick<
  RadioRuntimeValue,
  | "currentTrackId"
  | "onPlay"
  | "onPlayAt"
  | "onQueue"
  | "onTogglePlayback"
  | "playbackClock"
  | "playing"
>;

type RadioFavoritesRuntime = Pick<
  LocalFavoritesController,
  "favoriteRadioShowIds" | "toggleRadioFavorite"
>;

export type RadioRuntimeAdapterOptions = Readonly<{
  favorites: RadioFavoritesRuntime;
  playback: RadioPlaybackRuntime;
}>;

/** Projects playback and device-local Favorites into anonymous Radio routes. */
export function useRadioRuntimeAdapter({
  favorites,
  playback,
}: RadioRuntimeAdapterOptions): RadioRuntimeValue {
  const { favoriteRadioShowIds, toggleRadioFavorite } = favorites;
  const {
    currentTrackId,
    onPlay,
    onPlayAt,
    onQueue,
    onTogglePlayback,
    playbackClock,
    playing,
  } = playback;

  return useMemo(
    () => ({
      currentTrackId,
      favoriteShowIds: favoriteRadioShowIds,
      onPlay,
      onPlayAt,
      onQueue,
      onToggleFavorite: toggleRadioFavorite,
      onTogglePlayback,
      playbackClock,
      playing,
    }),
    [
      currentTrackId,
      favoriteRadioShowIds,
      onPlay,
      onPlayAt,
      onQueue,
      onTogglePlayback,
      playbackClock,
      playing,
      toggleRadioFavorite,
    ],
  );
}
