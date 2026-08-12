import { createContext, useContext } from "react";

import type { PlaybackClock } from "@/playbackClock";

import type {
  PlaybackQueueCommands,
  PlaybackQueueStatus,
  PlaybackSessionCommands,
  PlaybackShuffleCommands,
  PlaybackTransportCommands,
  PlaybackTransportModel,
} from "./types";

export const PlaybackQueueStatusContext = createContext<
  PlaybackQueueStatus | undefined
>(undefined);
export const PlaybackTransportModelContext = createContext<
  PlaybackTransportModel | undefined
>(undefined);
export const PlaybackQueueCommandsContext = createContext<
  PlaybackQueueCommands | undefined
>(undefined);
export const PlaybackTransportCommandsContext = createContext<
  PlaybackTransportCommands | undefined
>(undefined);
export const PlaybackSessionCommandsContext = createContext<
  PlaybackSessionCommands | undefined
>(undefined);
export const PlaybackShuffleContext = createContext<
  PlaybackShuffleCommands | undefined
>(undefined);
export const PlaybackClockContext = createContext<PlaybackClock | undefined>(
  undefined,
);

function requiredContext<Value>(value: Value | undefined, name: string): Value {
  if (value === undefined) {
    throw new Error(`${name} requires the Playback runtime provider`);
  }
  return value;
}

export function usePlaybackQueueStatus(): PlaybackQueueStatus {
  return requiredContext(
    useContext(PlaybackQueueStatusContext),
    "usePlaybackQueueStatus",
  );
}

export function usePlaybackTransportModel(): PlaybackTransportModel {
  return requiredContext(
    useContext(PlaybackTransportModelContext),
    "usePlaybackTransportModel",
  );
}

export function usePlaybackQueueCommands(): PlaybackQueueCommands {
  return requiredContext(
    useContext(PlaybackQueueCommandsContext),
    "usePlaybackQueueCommands",
  );
}

export function usePlaybackTransportCommands(): PlaybackTransportCommands {
  return requiredContext(
    useContext(PlaybackTransportCommandsContext),
    "usePlaybackTransportCommands",
  );
}

export function usePlaybackSessionCommands(): PlaybackSessionCommands {
  return requiredContext(
    useContext(PlaybackSessionCommandsContext),
    "usePlaybackSessionCommands",
  );
}

export function usePlaybackShuffle(): PlaybackShuffleCommands {
  return requiredContext(
    useContext(PlaybackShuffleContext),
    "usePlaybackShuffle",
  );
}

/** The clock is stable; subscribing to its position remains caller-local. */
export function usePlaybackClock(): PlaybackClock {
  return requiredContext(useContext(PlaybackClockContext), "usePlaybackClock");
}
