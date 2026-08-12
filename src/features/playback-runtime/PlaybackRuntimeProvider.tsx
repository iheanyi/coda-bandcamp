import { useMemo, type ReactNode } from "react";

import {
  PlaybackClockContext,
  PlaybackQueueCommandsContext,
  PlaybackQueueStatusContext,
  PlaybackSessionCommandsContext,
  PlaybackShuffleContext,
  PlaybackTransportCommandsContext,
  PlaybackTransportModelContext,
} from "./playbackRuntimeContext";
import type { PlaybackQueueStatus, PlaybackRuntimeController } from "./types";

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
