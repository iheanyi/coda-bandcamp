import { useCallback, useMemo, useRef, useState } from "react";

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
  PlaybackPersistenceAdapters,
  PlaybackRuntimeAdapters,
  PlaybackRuntimeController,
  PlaybackRuntimeOptions,
  PlaybackScrobbleAdapters,
  PlaybackSystemMediaAdapters,
} from "./types";

type ResolvedPlaybackAdapters = {
  persistence: PlaybackPersistenceAdapters;
  audio: PlaybackAudioAdapters;
  scrobbling: PlaybackScrobbleAdapters;
  systemMedia: PlaybackSystemMediaAdapters;
};

function useResolvedAdapters(
  overrides: PlaybackRuntimeAdapters | undefined,
): ResolvedPlaybackAdapters {
  const overridesRef = useRef(overrides);
  overridesRef.current = overrides;
  const [resolved] = useState<ResolvedPlaybackAdapters>(() => ({
    persistence: {
      load: () =>
        (
          overridesRef.current?.persistence?.load ??
          defaultPlaybackPersistenceAdapters.load
        )(),
      save: (input) =>
        (
          overridesRef.current?.persistence?.save ??
          defaultPlaybackPersistenceAdapters.save
        )(input),
      checkpoint: (input) =>
        (
          overridesRef.current?.persistence?.checkpoint ??
          defaultPlaybackPersistenceAdapters.checkpoint
        )(input),
      clear: () =>
        (
          overridesRef.current?.persistence?.clear ??
          defaultPlaybackPersistenceAdapters.clear
        )(),
    },
    audio: {
      fetchStreamUrl: (trackId) =>
        (
          overridesRef.current?.audio?.fetchStreamUrl ??
          defaultPlaybackAudioAdapters.fetchStreamUrl
        )(trackId),
      invalidateStreamUrl: (trackId) =>
        (
          overridesRef.current?.audio?.invalidateStreamUrl ??
          defaultPlaybackAudioAdapters.invalidateStreamUrl
        )(trackId),
      loadDailyTrack: (track) =>
        (
          overridesRef.current?.audio?.loadDailyTrack ??
          defaultPlaybackAudioAdapters.loadDailyTrack
        )(track),
      loadRadioShow: (showId) =>
        (
          overridesRef.current?.audio?.loadRadioShow ??
          defaultPlaybackAudioAdapters.loadRadioShow
        )(showId),
      recordDiagnostic: (event) =>
        (
          overridesRef.current?.audio?.recordDiagnostic ??
          defaultPlaybackAudioAdapters.recordDiagnostic
        )(event),
    },
    scrobbling: {
      updateNowPlaying: (track) =>
        (
          overridesRef.current?.scrobbling?.updateNowPlaying ??
          defaultPlaybackScrobbleAdapters.updateNowPlaying
        )(track),
      scrobble: (track, timestamp) =>
        (
          overridesRef.current?.scrobbling?.scrobble ??
          defaultPlaybackScrobbleAdapters.scrobble
        )(track, timestamp),
      nowSeconds: () =>
        (
          overridesRef.current?.scrobbling?.nowSeconds ??
          defaultPlaybackScrobbleAdapters.nowSeconds
        )(),
    },
    systemMedia: {
      coverArtSource: (coverArtId) =>
        (
          overridesRef.current?.systemMedia?.coverArtSource ??
          defaultPlaybackSystemMediaAdapters.coverArtSource
        )(coverArtId),
      createArtworkDataUrl: (input) =>
        (
          overridesRef.current?.systemMedia?.createArtworkDataUrl ??
          defaultPlaybackSystemMediaAdapters.createArtworkDataUrl
        )(input),
      syncBrowserPlayback: (input) =>
        (
          overridesRef.current?.systemMedia?.syncBrowserPlayback ??
          defaultPlaybackSystemMediaAdapters.syncBrowserPlayback
        )(input),
      installBrowserHandlers: (handlers) =>
        (
          overridesRef.current?.systemMedia?.installBrowserHandlers ??
          defaultPlaybackSystemMediaAdapters.installBrowserHandlers
        )(handlers),
      updateNativeMetadata: (input) =>
        (
          overridesRef.current?.systemMedia?.updateNativeMetadata ??
          defaultPlaybackSystemMediaAdapters.updateNativeMetadata
        )(input),
      updateNativePlayback: (playing) =>
        (
          overridesRef.current?.systemMedia?.updateNativePlayback ??
          defaultPlaybackSystemMediaAdapters.updateNativePlayback
        )(playing),
      updateNativeTimeline: (positionSeconds, durationSeconds) =>
        (
          overridesRef.current?.systemMedia?.updateNativeTimeline ??
          defaultPlaybackSystemMediaAdapters.updateNativeTimeline
        )(positionSeconds, durationSeconds),
      installDesktopControls: (handlers) =>
        (
          overridesRef.current?.systemMedia?.installDesktopControls ??
          defaultPlaybackSystemMediaAdapters.installDesktopControls
        )(handlers),
    },
  }));
  return resolved;
}

/**
 * Owns the persistent player independently from route lifetime. The returned
 * interface is grouped by queue, transport, persistence, and shuffle concerns;
 * playback position remains on the external clock rather than React state.
 */
export function usePlaybackRuntimeController(
  options: PlaybackRuntimeOptions,
): PlaybackRuntimeController {
  const adapters = useResolvedAdapters(options.adapters);
  const audioRef = useRef<HTMLAudioElement>(null);
  const notifyRef = useRef(options.notify);
  notifyRef.current = options.notify;
  const notify = useCallback(
    (...args: Parameters<PlaybackRuntimeOptions["notify"]>) =>
      notifyRef.current(...args),
    [],
  );
  const recordPlayRequest = useCallback(
    () => adapters.audio.recordDiagnostic("renderer.play.request"),
    [adapters.audio],
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
      adapters: adapters.scrobbling,
      getEnvironment: () => scrobbleEnvironmentRef.current,
    }),
  );
  const persistence = usePlaybackPersistenceController({
    adapters: adapters.persistence,
    core,
    notify,
    scrobbling,
    timing: options.persistenceTiming,
  });
  const systemMedia = usePlaybackSystemMediaController({
    adapters: adapters.systemMedia,
    albums: options.albums,
    core,
    notify,
    onShuffleEntireLibrary: options.onShuffleEntireLibrary,
  });
  const audio = usePlaybackAudioController({
    adapters: adapters.audio,
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
