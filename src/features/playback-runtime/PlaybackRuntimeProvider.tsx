import { createContext, useContext, useMemo, type ReactNode } from "react";

import type { PlaybackClock } from "@/playbackClock";

import type {
  PlaybackQueueCommands,
  PlaybackQueueStatus,
  PlaybackRuntimeController,
  PlaybackSessionCommands,
  PlaybackShuffleCommands,
  PlaybackTransportCommands,
  PlaybackTransportModel,
} from "./types";

const PlaybackQueueStatusContext = createContext<
  PlaybackQueueStatus | undefined
>(undefined);
const PlaybackTransportModelContext = createContext<
  PlaybackTransportModel | undefined
>(undefined);
const PlaybackQueueCommandsContext = createContext<
  PlaybackQueueCommands | undefined
>(undefined);
const PlaybackTransportCommandsContext = createContext<
  PlaybackTransportCommands | undefined
>(undefined);
const PlaybackSessionCommandsContext = createContext<
  PlaybackSessionCommands | undefined
>(undefined);
const PlaybackShuffleContext = createContext<
  PlaybackShuffleCommands | undefined
>(undefined);
const PlaybackClockContext = createContext<PlaybackClock | undefined>(
  undefined,
);

function requiredContext<Value>(value: Value | undefined, name: string): Value {
  if (value === undefined) {
    throw new Error(`${name} requires the Playback runtime provider`);
  }
  return value;
}

/**
 * Composes selector-oriented playback providers and mounts the single
 * persistent audio element. Signed stream state never enters any Context.
 */
export function PlaybackRuntimeProvider({
  children,
  controller,
}: Readonly<{
  children: ReactNode;
  controller: PlaybackRuntimeController;
}>) {
  const queueStatus = useMemo<PlaybackQueueStatus>(
    () => ({
      currentIndex: controller.queue.currentIndex,
      currentTrackId: controller.queue.currentTrack?.id,
      currentAlbumId: controller.queue.currentTrack?.albumId,
      length: controller.queue.queue.length,
      open: controller.queue.open,
      ready: controller.queue.ready,
      hasDeferredTracks: controller.queue.hasDeferredTracks,
    }),
    [
      controller.queue.currentIndex,
      controller.queue.currentTrack?.id,
      controller.queue.currentTrack?.albumId,
      controller.queue.queue.length,
      controller.queue.open,
      controller.queue.ready,
      controller.queue.hasDeferredTracks,
    ],
  );

  return (
    <PlaybackClockContext.Provider value={controller.playbackClock}>
      <PlaybackSessionCommandsContext.Provider
        value={controller.sessionCommands}
      >
        <PlaybackShuffleContext.Provider value={controller.shuffle}>
          <PlaybackQueueCommandsContext.Provider
            value={controller.queueCommands}
          >
            <PlaybackTransportCommandsContext.Provider
              value={controller.transportCommands}
            >
              <PlaybackQueueStatusContext.Provider value={queueStatus}>
                <PlaybackTransportModelContext.Provider
                  value={controller.transport}
                >
                  {children}
                  {controller.audioElement}
                </PlaybackTransportModelContext.Provider>
              </PlaybackQueueStatusContext.Provider>
            </PlaybackTransportCommandsContext.Provider>
          </PlaybackQueueCommandsContext.Provider>
        </PlaybackShuffleContext.Provider>
      </PlaybackSessionCommandsContext.Provider>
    </PlaybackClockContext.Provider>
  );
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
