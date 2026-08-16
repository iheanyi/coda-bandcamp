import { useCallback, useEffect, useMemo, useRef } from "react";

import {
  isEphemeralTrackId,
  normalizedReleaseTitle,
  persistedQueueIndex,
} from "@/playerState";
import type {
  PlayerStateCheckpoint,
  PlayerStateInput,
  PlayerStateTrack,
  Track,
} from "@/types";

import type { PlaybackCoreController } from "./core";
import { safePlaybackErrorDetail } from "./errors";
import type { PlaybackScrobbleController } from "./scrobbling";
import type {
  PlaybackNotify,
  PlaybackPersistenceAdapters,
  PlaybackSessionCommands,
} from "./types";

const DEFAULT_STRUCTURAL_SAVE_DEBOUNCE_MS = 450;
const DEFAULT_CHECKPOINT_INTERVAL_MS = 5_000;

function persistentTrack(track: Track): PlayerStateTrack {
  const persistent: PlayerStateTrack = {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: normalizedReleaseTitle(track.album),
    albumId: track.albumId,
    duration: track.duration,
    track: track.track,
    palette: [track.palette[0], track.palette[1]],
  };
  if (track.disc !== undefined) persistent.disc = track.disc;
  if (track.coverArt !== undefined) persistent.coverArt = track.coverArt;
  return persistent;
}

type PersistentQueueProjection = {
  queue: PlayerStateTrack[];
  currentIndex: number;
  currentWasOmitted: boolean;
};

function persistentQueueProjection(
  queue: readonly Track[],
  currentIndex: number,
): PersistentQueueProjection {
  const persistentQueue: PlayerStateTrack[] = [];
  let retainedThroughCurrent = 0;
  let currentWasOmitted = false;
  queue.forEach((track, index) => {
    const ephemeral = isEphemeralTrackId(track.id);
    if (!ephemeral) persistentQueue.push(persistentTrack(track));
    if (index <= currentIndex && !ephemeral) retainedThroughCurrent += 1;
    if (index === currentIndex) currentWasOmitted = ephemeral;
  });
  const projectedIndex = !persistentQueue.length
    ? 0
    : currentWasOmitted
      ? Math.min(retainedThroughCurrent, persistentQueue.length - 1)
      : Math.max(0, retainedThroughCurrent - 1);
  return {
    queue: persistentQueue,
    currentIndex: projectedIndex,
    currentWasOmitted,
  };
}

export function preparePersistentPlayerState(
  core: PlaybackCoreController,
  scrobbling: PlaybackScrobbleController,
): PlayerStateInput {
  const snapshot = core.getSnapshot();
  const currentTrack = snapshot.queue[snapshot.currentIndex];
  const projection = persistentQueueProjection(
    snapshot.queue,
    snapshot.currentIndex,
  );
  const keepCurrentProgress =
    Boolean(currentTrack) && !projection.currentWasOmitted;
  const state: PlayerStateInput = {
    queue: projection.queue,
    currentIndex: projection.currentIndex,
    positionSeconds:
      projection.queue.length && keepCurrentProgress
        ? core.playbackClock.readExact()
        : 0,
    volume: snapshot.volume,
    repeatMode: snapshot.repeatMode,
    queueOpen: snapshot.queueOpen,
  };
  if (keepCurrentProgress) {
    state.lastFmProgress = scrobbling.persistedLastFmProgress(currentTrack);
    state.radioScrobbleProgress =
      scrobbling.persistedRadioProgress(currentTrack);
  }
  return state;
}

export function preparePlayerCheckpoint(
  core: PlaybackCoreController,
  scrobbling: PlaybackScrobbleController,
): PlayerStateCheckpoint | undefined {
  const snapshot = core.getSnapshot();
  const track = snapshot.queue[snapshot.currentIndex];
  if (!track || isEphemeralTrackId(track.id)) return undefined;
  return {
    currentIndex: persistedQueueIndex(snapshot.queue, snapshot.currentIndex),
    currentTrackId: track.id,
    positionSeconds: core.playbackClock.readExact(),
    lastFmProgress: scrobbling.persistedLastFmProgress(track),
    radioScrobbleProgress: scrobbling.persistedRadioProgress(track),
  };
}

export type PlaybackPersistenceController = {
  commands: PlaybackSessionCommands;
  checkpoint: () => Promise<boolean>;
};

export function usePlaybackPersistenceController({
  adapters,
  core,
  notify,
  scrobbling,
  timing,
}: {
  adapters: PlaybackPersistenceAdapters;
  core: PlaybackCoreController;
  notify: PlaybackNotify;
  scrobbling: PlaybackScrobbleController;
  timing?: {
    structuralSaveDebounceMs?: number;
    checkpointIntervalMs?: number;
  };
}): PlaybackPersistenceController {
  const restoreGenerationRef = useRef(0);
  const writeRef = useRef<Promise<void>>(Promise.resolve());
  const errorNotifiedRef = useRef(false);
  const coreRef = useRef(core);
  coreRef.current = core;
  const applyRestore = core.internal.applyRestore;
  const resetCore = core.internal.reset;
  const setCoreReady = core.internal.setReady;
  const getCoreSnapshot = core.getSnapshot;
  const playbackClock = core.playbackClock;
  const load = adapters.load;
  const save = adapters.save;
  const saveCheckpoint = adapters.checkpoint;
  const clearPersistedState = adapters.clear;

  const reportError = useCallback(
    (summary: string, cause: unknown) => {
      if (errorNotifiedRef.current) return;
      errorNotifiedRef.current = true;
      notify(`${summary}: ${safePlaybackErrorDetail(cause)}`, "bad");
    },
    [notify],
  );

  const enqueueWrite = useCallback(
    <Value>(write: () => Promise<Value>): Promise<Value> => {
      const result = writeRef.current.catch(() => undefined).then(write);
      writeRef.current = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    [],
  );

  useEffect(() => {
    let active = true;
    const generation = restoreGenerationRef.current + 1;
    restoreGenerationRef.current = generation;
    void load()
      .then((state) => {
        if (!active || restoreGenerationRef.current !== generation || !state) {
          return;
        }
        scrobbling.restore(state);
        applyRestore(state);
      })
      .catch((cause) => {
        if (active && restoreGenerationRef.current === generation) {
          reportError(
            "Coda could not restore the previous listening session",
            cause,
          );
        }
      })
      .finally(() => {
        if (active && restoreGenerationRef.current === generation) {
          setCoreReady(true);
        }
      });
    return () => {
      active = false;
    };
  }, [applyRestore, load, reportError, scrobbling, setCoreReady]);

  const currentTrackId = core.queueModel.currentTrack?.id;
  const activationGeneration = core.snapshot.activationGeneration;
  useEffect(() => {
    scrobbling.activateTrack(
      getCoreSnapshot().queue[getCoreSnapshot().currentIndex],
      playbackClock.readExact(),
    );
  }, [
    activationGeneration,
    currentTrackId,
    getCoreSnapshot,
    playbackClock,
    scrobbling,
  ]);

  const checkpoint = useCallback(() => {
    const input = preparePlayerCheckpoint(coreRef.current, scrobbling);
    if (!input) return Promise.resolve(false);
    return enqueueWrite(() => saveCheckpoint(input));
  }, [enqueueWrite, saveCheckpoint, scrobbling]);

  const { currentIndex, queue, queueOpen, ready, repeatMode, volume, playing } =
    core.snapshot;
  useEffect(() => {
    if (!ready) return;
    const generation = restoreGenerationRef.current;
    const timer = window.setTimeout(() => {
      if (restoreGenerationRef.current !== generation) return;
      const state = preparePersistentPlayerState(coreRef.current, scrobbling);
      void enqueueWrite(() => save(state))
        .then(() => {
          errorNotifiedRef.current = false;
        })
        .catch((cause) => {
          reportError("Coda could not preserve this queue", cause);
        });
    }, timing?.structuralSaveDebounceMs ?? DEFAULT_STRUCTURAL_SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [
    currentIndex,
    enqueueWrite,
    queue,
    queueOpen,
    ready,
    repeatMode,
    reportError,
    save,
    scrobbling,
    timing?.structuralSaveDebounceMs,
    volume,
  ]);

  useEffect(() => {
    if (!ready) return;
    const interval = window.setInterval(() => {
      void checkpoint()
        .then((saved) => {
          if (saved) errorNotifiedRef.current = false;
        })
        .catch((cause) => {
          reportError("Coda could not checkpoint playback", cause);
        });
    }, timing?.checkpointIntervalMs ?? DEFAULT_CHECKPOINT_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [checkpoint, ready, reportError, timing?.checkpointIntervalMs]);

  useEffect(() => {
    if (!ready || playing) return;
    void checkpoint()
      .then((saved) => {
        if (saved) errorNotifiedRef.current = false;
      })
      .catch((cause) => {
        reportError("Coda could not checkpoint paused playback", cause);
      });
  }, [checkpoint, playing, ready, reportError]);

  const reset = useCallback(
    (options: { ready?: boolean } = {}) => {
      restoreGenerationRef.current += 1;
      scrobbling.clear();
      resetCore(options);
    },
    [resetCore, scrobbling],
  );

  const clear = useCallback(async () => {
    reset({ ready: false });
    try {
      await enqueueWrite(clearPersistedState);
      errorNotifiedRef.current = false;
    } catch (cause) {
      reportError("Coda could not clear the saved player session", cause);
    }
  }, [clearPersistedState, enqueueWrite, reportError, reset]);

  const setReady = useCallback(
    (nextReady: boolean) => setCoreReady(nextReady),
    [setCoreReady],
  );
  const commands = useMemo<PlaybackSessionCommands>(
    () => ({ checkpoint, clear, reset, setReady }),
    [checkpoint, clear, reset, setReady],
  );

  return {
    checkpoint,
    commands,
  };
}
