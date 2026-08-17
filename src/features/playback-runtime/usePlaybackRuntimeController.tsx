import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";

import { radioShowRestoreQueryOptions } from "@/queries/radioQueries";

import {
  defaultPlaybackAudioAdapters,
  defaultPlaybackPersistenceAdapters,
  defaultPlaybackScrobbleAdapters,
  defaultPlaybackSystemMediaAdapters,
} from "./adapters";
import { usePlaybackAudioController } from "./audio";
import { usePlaybackCoreController } from "./core";
import { usePlaybackPersistenceController } from "./persistence";
import { createPlaybackScrobbleController } from "./scrobbling";
import { usePlaybackSystemMediaController } from "./systemMedia";
import type {
  PlaybackAudioAdapters,
  PlaybackRuntimeController,
  PlaybackRuntimeOptions,
} from "./types";

/**
 * Owns the persistent player independently from route lifetime. The returned
 * interface is grouped by queue, transport, persistence, and shuffle concerns;
 * playback position remains on the external clock rather than React state.
 */
export function usePlaybackRuntimeController(
  options: PlaybackRuntimeOptions,
): PlaybackRuntimeController {
  const queryClient = useQueryClient();
  const audioAdapters = useMemo<PlaybackAudioAdapters>(
    () => ({
      ...defaultPlaybackAudioAdapters,
      loadRadioShow: (showId) =>
        queryClient.fetchQuery(radioShowRestoreQueryOptions(showId)),
    }),
    [queryClient],
  );
  const audioRef = useRef<HTMLAudioElement>(null);
  const notifyRef = useRef(options.notify);
  notifyRef.current = options.notify;
  const notify = useCallback(
    (...args: Parameters<PlaybackRuntimeOptions["notify"]>) =>
      notifyRef.current(...args),
    [],
  );
  const recordPlayRequest = useCallback(
    () => audioAdapters.recordDiagnostic("renderer.play.request"),
    [audioAdapters],
  );
  const core = usePlaybackCoreController({
    audioRef,
    notify,
    progressiveShuffle: options.progressiveShuffle,
    recordPlayRequest,
  });
  const scrobbleEnvironmentRef = useRef({
    connected: options.lastFmConnected,
    notify,
  });
  scrobbleEnvironmentRef.current = {
    connected: options.lastFmConnected,
    notify,
  };
  const [scrobbling] = useState(() =>
    createPlaybackScrobbleController({
      adapters: defaultPlaybackScrobbleAdapters,
      getEnvironment: () => scrobbleEnvironmentRef.current,
    }),
  );
  const persistence = usePlaybackPersistenceController({
    adapters: defaultPlaybackPersistenceAdapters,
    core,
    notify,
    scrobbling,
    timing: options.persistenceTiming,
  });
  const systemMedia = usePlaybackSystemMediaController({
    adapters: defaultPlaybackSystemMediaAdapters,
    albums: options.albums,
    core,
    notify,
    onShuffleEntireLibrary: options.onShuffleEntireLibrary,
  });
  const audio = usePlaybackAudioController({
    adapters: audioAdapters,
    connected: options.connected,
    core,
    notify,
    persistence,
    scrobbling,
    systemMedia,
  });

  const transport = useMemo(
    () => ({
      ...core.transportModel,
      airPlayAvailable: audio.airPlayAvailable,
    }),
    [audio.airPlayAvailable, core.transportModel],
  );
  const transportCommands = useMemo(
    () => ({
      ...core.transportCommands,
      openAirPlay: audio.openAirPlay,
    }),
    [audio.openAirPlay, core.transportCommands],
  );

  return {
    queue: core.publicQueueModel,
    transport,
    queueCommands: core.queueCommands,
    transportCommands,
    sessionCommands: persistence.commands,
    shuffle: core.shuffle,
    playbackClock: core.playbackClock,
    audioElement: audio.element,
  };
}
