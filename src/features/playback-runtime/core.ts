import { useCallback, useMemo, useRef, useState, type RefObject } from "react";

import { PREVIOUS_RESTART_THRESHOLD_SECONDS } from "@/features/player/constants";
import { createPlaybackClock, type PlaybackClock } from "@/playbackClock";
import {
  activateTrack,
  appendUnique,
  keepCurrentTrack,
  moveItem,
  shuffled,
} from "@/queue";
import {
  boundRadioChapters,
  nextRadioChapterTimeInTimeline,
  previousRadioChapterTimeInTimeline,
} from "@/radioPlayback";
import type { PlayerStateSnapshot, Track } from "@/types";
import {
  useProgressiveLibraryShuffle,
  type ProgressiveLibraryShufflePlayerMutation,
} from "@/useProgressiveLibraryShuffle";

import type {
  PlaybackCoreMutation,
  PlaybackCoreSnapshot,
  PlaybackProgressiveMutation,
  PlaybackQueueCommands,
  PlaybackQueueModel,
  PlaybackShuffleCommands,
  PlaybackTransportCommands,
  PlaybackTransportModel,
  ProgressivePlaybackShuffleOptions,
  PlaybackNotify,
} from "./types";
import { publicPlaybackQueueTrack } from "./publicQueue";

const DEFAULT_VOLUME = 0.72;

const disconnectedShuffleOptions: ProgressivePlaybackShuffleOptions = {
  connected: false,
  getConnectionGeneration: () => 0,
  loadAlbumTracks: () => Promise.resolve([]),
  recoverAlbum: (album) => album,
  applyRecoveredAlbums: () => undefined,
};

function initialCoreSnapshot(): PlaybackCoreSnapshot {
  return {
    queue: [],
    currentIndex: 0,
    activationGeneration: 0,
    playing: false,
    volume: DEFAULT_VOLUME,
    repeatMode: "off",
    queueOpen: false,
    ready: false,
  };
}

function boundedVolume(volume: number): number {
  return Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0;
}

function normalizedSnapshot(
  candidate: PlaybackCoreSnapshot,
): PlaybackCoreSnapshot {
  const currentIndex = candidate.queue.length
    ? Math.min(
        candidate.queue.length - 1,
        Math.max(0, Math.trunc(candidate.currentIndex)),
      )
    : 0;
  return {
    ...candidate,
    currentIndex,
    playing: candidate.queue.length ? candidate.playing : false,
    volume: boundedVolume(candidate.volume),
  };
}

export type PlaybackPendingPosition = {
  trackId: string;
  positionSeconds: number;
};

type PlaybackInternalQueueModel = {
  queue: Track[];
  currentIndex: number;
  currentTrack?: Track;
  currentRadioTimeline: readonly import("@/types").RadioChapter[];
  open: boolean;
  ready: boolean;
  hasDeferredTracks: boolean;
};

export type PlaybackCoreController = {
  snapshot: PlaybackCoreSnapshot;
  getSnapshot: () => PlaybackCoreSnapshot;
  playbackClock: PlaybackClock;
  audioRef: RefObject<HTMLAudioElement | null>;
  queueModel: PlaybackInternalQueueModel;
  publicQueueModel: PlaybackQueueModel;
  transportModel: Omit<PlaybackTransportModel, "airPlayAvailable">;
  queueCommands: PlaybackQueueCommands;
  transportCommands: Omit<PlaybackTransportCommands, "openAirPlay">;
  shuffle: PlaybackShuffleCommands;
  internal: {
    applyRestore: (state: PlayerStateSnapshot) => void;
    commit: (mutation: PlaybackCoreMutation) => void;
    commitProgressiveMutation: (mutation: PlaybackProgressiveMutation) => void;
    replaceCurrentTrack: (trackId: string, replacement: Track) => void;
    reset: (options?: { ready?: boolean }) => void;
    setReady: (ready: boolean) => void;
    advanceAfterEnded: () => void;
    seekFromSystemMedia: (positionSeconds: number) => void;
    pendingPosition: RefObject<PlaybackPendingPosition | undefined>;
  };
};

export function usePlaybackCoreController({
  audioRef,
  notify,
  progressiveShuffle,
  recordPlayRequest,
}: {
  audioRef: RefObject<HTMLAudioElement | null>;
  notify: PlaybackNotify;
  progressiveShuffle?: ProgressivePlaybackShuffleOptions;
  recordPlayRequest: () => void;
}): PlaybackCoreController {
  const [playbackClock] = useState(createPlaybackClock);
  const [snapshot, setSnapshot] = useState(initialCoreSnapshot);
  const snapshotRef = useRef(snapshot);
  const pendingPosition = useRef<PlaybackPendingPosition | undefined>(
    undefined,
  );
  const cancelShuffleRef = useRef<() => void>(() => undefined);

  const commit = useCallback((mutation: PlaybackCoreMutation) => {
    const current = snapshotRef.current;
    const candidate = mutation(current);
    if (candidate === current) return;
    const next = normalizedSnapshot(candidate);
    snapshotRef.current = next;
    setSnapshot(next);
  }, []);

  const getSnapshot = useCallback(() => snapshotRef.current, []);

  const getShufflePlayerState = useCallback(() => {
    const current = snapshotRef.current;
    return {
      queue: current.queue,
      currentIndex: current.currentIndex,
      repeatMode: current.repeatMode,
    };
  }, []);

  const commitProgressiveMutation = useCallback(
    (mutation: ProgressiveLibraryShufflePlayerMutation) => {
      commit((current) => ({
        ...current,
        queue: mutation.queue,
        currentIndex: mutation.currentIndex,
        activationGeneration: mutation.resetPlayback
          ? current.activationGeneration + 1
          : current.activationGeneration,
        playing: mutation.playing ?? current.playing,
      }));
      if (mutation.resetPlayback) {
        pendingPosition.current = undefined;
        playbackClock.reset();
        if (audioRef.current) audioRef.current.currentTime = 0;
      }
    },
    [audioRef, commit, playbackClock],
  );

  const shuffleOptions = progressiveShuffle ?? disconnectedShuffleOptions;
  const progressive = useProgressiveLibraryShuffle({
    connected: shuffleOptions.connected,
    queue: snapshot.queue,
    currentIndex: snapshot.currentIndex,
    playing: snapshot.playing,
    getConnectionGeneration: shuffleOptions.getConnectionGeneration,
    loadAlbumTracks: shuffleOptions.loadAlbumTracks,
    recoverAlbum: shuffleOptions.recoverAlbum,
    applyRecoveredAlbums: shuffleOptions.applyRecoveredAlbums,
    getPlayerState: getShufflePlayerState,
    commitPlayerMutation: commitProgressiveMutation,
    notify,
  });
  cancelShuffleRef.current = progressive.cancel;
  const waitForProgressiveAdvance = progressive.waitForAdvance;

  const applyRestore = useCallback(
    (state: PlayerStateSnapshot) => {
      cancelShuffleRef.current();
      const queue = state.queue as Track[];
      const restoredTrack = queue[state.currentIndex];
      pendingPosition.current =
        restoredTrack && state.positionSeconds > 0
          ? {
              trackId: restoredTrack.id,
              positionSeconds: state.positionSeconds,
            }
          : undefined;
      playbackClock.restore(state.positionSeconds);
      commit((current) => ({
        ...current,
        queue,
        currentIndex: state.currentIndex,
        activationGeneration: current.activationGeneration + 1,
        playing: false,
        volume: state.volume,
        repeatMode: state.repeatMode,
        queueOpen: Boolean(restoredTrack) && state.queueOpen,
      }));
    },
    [commit, playbackClock],
  );

  const reset = useCallback(
    (options: { ready?: boolean } = {}) => {
      cancelShuffleRef.current();
      pendingPosition.current = undefined;
      playbackClock.reset();
      commit(() => ({
        ...initialCoreSnapshot(),
        ready: options.ready ?? false,
      }));
    },
    [commit, playbackClock],
  );

  const setReady = useCallback(
    (ready: boolean) => {
      commit((current) =>
        current.ready === ready ? current : { ...current, ready },
      );
    },
    [commit],
  );

  const replaceCurrentTrack = useCallback(
    (trackId: string, replacement: Track) => {
      commit((current) => {
        if (current.queue[current.currentIndex]?.id !== trackId) return current;
        const queue = current.queue.map((track, index) =>
          index === current.currentIndex && track.id === trackId
            ? replacement
            : track,
        );
        return { ...current, queue };
      });
    },
    [commit],
  );

  const playTrack = useCallback(
    (track: Track) => {
      recordPlayRequest();
      const current = snapshotRef.current;
      const activated = activateTrack(
        current.queue,
        current.currentIndex,
        track,
      );
      if (activated.queue !== current.queue) cancelShuffleRef.current();
      pendingPosition.current = undefined;
      playbackClock.reset();
      if (audioRef.current) audioRef.current.currentTime = 0;
      commit((latest) => ({
        ...latest,
        queue: activated.queue,
        currentIndex: activated.currentIndex,
        activationGeneration: latest.activationGeneration + 1,
        playing: true,
      }));
    },
    [audioRef, commit, playbackClock, recordPlayRequest],
  );

  const playTrackAt = useCallback(
    (track: Track, positionSeconds: number) => {
      const safePosition = Number.isFinite(positionSeconds)
        ? Math.max(0, positionSeconds)
        : 0;
      const current = snapshotRef.current;
      const alreadyLoaded =
        current.queue[current.currentIndex]?.id === track.id &&
        Boolean(audioRef.current);
      playTrack(track);
      if (!alreadyLoaded && safePosition > 0) {
        pendingPosition.current = {
          trackId: track.id,
          positionSeconds: safePosition,
        };
      }
      playbackClock.seek(safePosition);
      if (alreadyLoaded && audioRef.current) {
        audioRef.current.currentTime = safePosition;
      }
    },
    [audioRef, playTrack, playbackClock],
  );

  const playTracks = useCallback(
    (tracks: Track[]) => {
      if (!tracks.length) return;
      cancelShuffleRef.current();
      recordPlayRequest();
      pendingPosition.current = undefined;
      playbackClock.reset();
      if (audioRef.current) audioRef.current.currentTime = 0;
      commit((current) => ({
        ...current,
        queue: tracks,
        currentIndex: 0,
        activationGeneration: current.activationGeneration + 1,
        playing: true,
      }));
    },
    [audioRef, commit, playbackClock, recordPlayRequest],
  );

  const queueTracks = useCallback(
    (tracks: Track[]) => {
      if (!tracks.length) return;
      const current = snapshotRef.current;
      const queue = appendUnique(current.queue, tracks);
      if (queue === current.queue) return;
      cancelShuffleRef.current();
      commit((latest) => ({ ...latest, queue }));
    },
    [commit],
  );

  const queueTrack = useCallback(
    (track: Track) => queueTracks([track]),
    [queueTracks],
  );

  const playQueueIndex = useCallback(
    (index: number) => {
      const current = snapshotRef.current;
      if (!Number.isInteger(index) || !current.queue[index]) return;
      pendingPosition.current = undefined;
      playbackClock.reset();
      if (audioRef.current) audioRef.current.currentTime = 0;
      commit((latest) => ({
        ...latest,
        currentIndex: index,
        activationGeneration: latest.activationGeneration + 1,
        playing: true,
      }));
    },
    [audioRef, commit, playbackClock],
  );

  const removeQueueItem = useCallback(
    (index: number) => {
      const current = snapshotRef.current;
      if (!Number.isInteger(index) || !current.queue[index]) return;
      cancelShuffleRef.current();
      const queue = current.queue.filter((_, itemIndex) => itemIndex !== index);
      const currentIndex = !queue.length
        ? 0
        : index < current.currentIndex
          ? current.currentIndex - 1
          : Math.min(current.currentIndex, queue.length - 1);
      if (!queue.length) {
        pendingPosition.current = undefined;
        playbackClock.reset();
      }
      commit((latest) => ({
        ...latest,
        queue,
        currentIndex,
        playing: queue.length ? latest.playing : false,
      }));
    },
    [commit, playbackClock],
  );

  const clearQueue = useCallback(() => {
    cancelShuffleRef.current();
    const current = snapshotRef.current;
    const currentTrack = current.queue[current.currentIndex];
    if (currentTrack) {
      commit((latest) => ({
        ...latest,
        queue: keepCurrentTrack(latest.queue, latest.currentIndex),
        currentIndex: 0,
      }));
      return;
    }
    pendingPosition.current = undefined;
    playbackClock.reset();
    commit((latest) => ({
      ...latest,
      queue: [],
      currentIndex: 0,
      playing: false,
    }));
  }, [commit, playbackClock]);

  const shuffleQueue = useCallback(() => {
    cancelShuffleRef.current();
    const current = snapshotRef.current;
    const head = current.queue[current.currentIndex]
      ? [current.queue[current.currentIndex]]
      : [];
    const queue = [
      ...head,
      ...shuffled(current.queue.slice(current.currentIndex + 1)),
    ];
    commit((latest) => ({ ...latest, queue, currentIndex: 0 }));
  }, [commit]);

  const moveQueueItem = useCallback(
    (from: number, to: number) => {
      cancelShuffleRef.current();
      commit((current) => ({
        ...current,
        queue: moveItem(current.queue, from, to),
      }));
    },
    [commit],
  );

  const setOpen = useCallback(
    (queueOpen: boolean) => {
      commit((current) =>
        current.queueOpen === queueOpen ? current : { ...current, queueOpen },
      );
    },
    [commit],
  );

  const play = useCallback(() => {
    const restartCompletedTrack = Boolean(audioRef.current?.ended);
    if (restartCompletedTrack) {
      pendingPosition.current = undefined;
      playbackClock.reset();
      if (audioRef.current) audioRef.current.currentTime = 0;
    }
    commit((current) =>
      current.queue[current.currentIndex]
        ? {
            ...current,
            playing: true,
            activationGeneration: restartCompletedTrack
              ? current.activationGeneration + 1
              : current.activationGeneration,
          }
        : current,
    );
  }, [audioRef, commit, playbackClock]);

  const pause = useCallback(() => {
    commit((current) =>
      current.playing ? { ...current, playing: false } : current,
    );
  }, [commit]);

  const toggle = useCallback(() => {
    const restartCompletedTrack = Boolean(
      !snapshotRef.current.playing && audioRef.current?.ended,
    );
    if (restartCompletedTrack) {
      pendingPosition.current = undefined;
      playbackClock.reset();
      if (audioRef.current) audioRef.current.currentTime = 0;
    }
    commit((current) =>
      current.queue[current.currentIndex]
        ? {
            ...current,
            playing: !current.playing,
            activationGeneration: restartCompletedTrack
              ? current.activationGeneration + 1
              : current.activationGeneration,
          }
        : current,
    );
  }, [audioRef, commit, playbackClock]);

  const seek = useCallback(
    (positionSeconds: number) => {
      const safePosition = Number.isFinite(positionSeconds)
        ? Math.max(0, positionSeconds)
        : 0;
      playbackClock.seek(safePosition);
      if (audioRef.current) audioRef.current.currentTime = safePosition;
    },
    [audioRef, playbackClock],
  );

  const seekFromSystemMedia = useCallback(
    (positionSeconds: number) => {
      const current = snapshotRef.current;
      const track = current.queue[current.currentIndex];
      const mediaDuration = audioRef.current?.duration;
      const durationSeconds =
        mediaDuration !== undefined && Number.isFinite(mediaDuration)
          ? mediaDuration
          : (track?.duration ?? 0);
      seek(
        durationSeconds > 0
          ? Math.min(durationSeconds, Math.max(0, positionSeconds))
          : Math.max(0, positionSeconds),
      );
    },
    [audioRef, seek],
  );

  const setVolume = useCallback(
    (volume: number) => {
      commit((current) => ({ ...current, volume: boundedVolume(volume) }));
    },
    [commit],
  );

  const cycleRepeat = useCallback(() => {
    commit((current) => ({
      ...current,
      repeatMode:
        current.repeatMode === "off"
          ? "all"
          : current.repeatMode === "all"
            ? "one"
            : "off",
    }));
  }, [commit]);

  const next = useCallback(() => {
    const current = snapshotRef.current;
    const currentTrack = current.queue[current.currentIndex];
    if (!currentTrack) return;
    const playbackSeconds =
      audioRef.current?.currentTime ?? playbackClock.readExact();
    const radioTimeline = boundRadioChapters(currentTrack.radioChapters ?? []);
    const chapterTime = nextRadioChapterTimeInTimeline(
      radioTimeline,
      playbackSeconds,
    );
    if (chapterTime !== undefined) {
      seek(chapterTime);
      return;
    }
    if (
      current.currentIndex + 1 >= current.queue.length &&
      waitForProgressiveAdvance("next")
    ) {
      return;
    }
    const nextIndex =
      current.currentIndex + 1 < current.queue.length
        ? current.currentIndex + 1
        : current.repeatMode === "all" && current.queue.length > 1
          ? 0
          : current.currentIndex;
    if (nextIndex === current.currentIndex) return;
    pendingPosition.current = undefined;
    playbackClock.reset();
    commit((latest) => ({
      ...latest,
      currentIndex: nextIndex,
      activationGeneration: latest.activationGeneration + 1,
    }));
  }, [audioRef, commit, playbackClock, seek, waitForProgressiveAdvance]);

  const previous = useCallback(() => {
    const current = snapshotRef.current;
    const currentTrack = current.queue[current.currentIndex];
    if (!currentTrack) return;
    const playbackSeconds =
      audioRef.current?.currentTime ?? playbackClock.readExact();
    const radioTimeline = boundRadioChapters(currentTrack.radioChapters ?? []);
    const chapterTime = previousRadioChapterTimeInTimeline(
      radioTimeline,
      playbackSeconds,
      PREVIOUS_RESTART_THRESHOLD_SECONDS,
    );
    if (chapterTime !== undefined) {
      seek(chapterTime);
      return;
    }
    if (playbackSeconds > PREVIOUS_RESTART_THRESHOLD_SECONDS) {
      seek(0);
      return;
    }
    const previousIndex =
      current.currentIndex > 0
        ? current.currentIndex - 1
        : current.repeatMode === "all" && current.queue.length > 1
          ? current.queue.length - 1
          : current.currentIndex;
    if (previousIndex === current.currentIndex) return;
    pendingPosition.current = undefined;
    playbackClock.reset();
    commit((latest) => ({
      ...latest,
      currentIndex: previousIndex,
      activationGeneration: latest.activationGeneration + 1,
    }));
  }, [audioRef, commit, playbackClock, seek]);

  const advanceAfterEnded = useCallback(() => {
    const current = snapshotRef.current;
    if (
      current.repeatMode !== "one" &&
      current.currentIndex + 1 >= current.queue.length &&
      waitForProgressiveAdvance("ended")
    ) {
      return;
    }
    pendingPosition.current = undefined;
    playbackClock.reset();
    if (current.repeatMode === "one" && audioRef.current) {
      audioRef.current.currentTime = 0;
    }
    commit((latest) => {
      if (latest.repeatMode === "one") {
        return {
          ...latest,
          activationGeneration: latest.activationGeneration + 1,
        };
      }
      if (latest.currentIndex + 1 < latest.queue.length) {
        return {
          ...latest,
          currentIndex: latest.currentIndex + 1,
          activationGeneration: latest.activationGeneration + 1,
        };
      }
      if (latest.repeatMode === "all") {
        return {
          ...latest,
          currentIndex: 0,
          activationGeneration: latest.activationGeneration + 1,
        };
      }
      return { ...latest, playing: false };
    });
  }, [audioRef, commit, playbackClock, waitForProgressiveAdvance]);

  const currentTrack = snapshot.queue[snapshot.currentIndex];
  const currentRadioTimeline = useMemo(
    () => boundRadioChapters(currentTrack?.radioChapters ?? []),
    [currentTrack?.radioChapters],
  );
  const internalQueueModel = useMemo<PlaybackInternalQueueModel>(
    () => ({
      queue: snapshot.queue,
      currentIndex: snapshot.currentIndex,
      currentTrack,
      currentRadioTimeline,
      open: snapshot.queueOpen,
      ready: snapshot.ready,
      hasDeferredTracks: progressive.hasMore,
    }),
    [
      currentRadioTimeline,
      currentTrack,
      progressive.hasMore,
      snapshot.currentIndex,
      snapshot.queue,
      snapshot.queueOpen,
      snapshot.ready,
    ],
  );
  const publicQueue = useMemo(
    () => snapshot.queue.map(publicPlaybackQueueTrack),
    [snapshot.queue],
  );
  const publicCurrentTrack = publicQueue[snapshot.currentIndex];
  const publicRadioTimeline = useMemo(
    () => boundRadioChapters(publicCurrentTrack?.radioChapters ?? []),
    [publicCurrentTrack?.radioChapters],
  );
  const publicQueueModel = useMemo<PlaybackQueueModel>(
    () => ({
      queue: publicQueue,
      currentIndex: snapshot.currentIndex,
      currentTrack: publicCurrentTrack,
      currentRadioTimeline: publicRadioTimeline,
      open: snapshot.queueOpen,
      ready: snapshot.ready,
      hasDeferredTracks: progressive.hasMore,
    }),
    [
      progressive.hasMore,
      publicCurrentTrack,
      publicQueue,
      publicRadioTimeline,
      snapshot.currentIndex,
      snapshot.queueOpen,
      snapshot.ready,
    ],
  );
  const transportModel = useMemo<
    Omit<PlaybackTransportModel, "airPlayAvailable">
  >(
    () => ({
      playing: snapshot.playing,
      volume: snapshot.volume,
      repeat: snapshot.repeatMode,
      canPrevious:
        Boolean(currentTrack) &&
        (snapshot.currentIndex > 0 ||
          (snapshot.repeatMode === "all" && snapshot.queue.length > 1)),
      canNext:
        Boolean(currentTrack) &&
        (snapshot.currentIndex + 1 < snapshot.queue.length ||
          progressive.hasMore ||
          (snapshot.repeatMode === "all" && snapshot.queue.length > 1)),
    }),
    [
      currentTrack,
      progressive.hasMore,
      snapshot.currentIndex,
      snapshot.playing,
      snapshot.queue.length,
      snapshot.repeatMode,
      snapshot.volume,
    ],
  );

  const queueCommands = useMemo<PlaybackQueueCommands>(
    () => ({
      playTrack,
      playTrackAt,
      playTracks,
      queueTrack,
      queueTracks,
      playQueueIndex,
      removeQueueItem,
      clearQueue,
      shuffleQueue,
      moveQueueItem,
      setOpen,
    }),
    [
      clearQueue,
      moveQueueItem,
      playQueueIndex,
      playTrack,
      playTrackAt,
      playTracks,
      queueTrack,
      queueTracks,
      removeQueueItem,
      setOpen,
      shuffleQueue,
    ],
  );
  const transportCommands = useMemo(
    () => ({
      toggle,
      play,
      pause,
      previous,
      next,
      seek,
      setVolume,
      cycleRepeat,
    }),
    [cycleRepeat, next, pause, play, previous, seek, setVolume, toggle],
  );
  const shuffle = useMemo<PlaybackShuffleCommands>(
    () => ({
      activeArtistScopeKey: progressive.activeArtistScopeKey,
      progress: progressive.progress,
      hasMore: progressive.hasMore,
      cancel: progressive.cancel,
      shuffle: progressive.shuffle,
    }),
    [
      progressive.activeArtistScopeKey,
      progressive.cancel,
      progressive.hasMore,
      progressive.progress,
      progressive.shuffle,
    ],
  );
  const internal = useMemo(
    () => ({
      applyRestore,
      commit,
      commitProgressiveMutation,
      replaceCurrentTrack,
      reset,
      setReady,
      advanceAfterEnded,
      seekFromSystemMedia,
      pendingPosition,
    }),
    [
      advanceAfterEnded,
      applyRestore,
      commit,
      commitProgressiveMutation,
      replaceCurrentTrack,
      reset,
      seekFromSystemMedia,
      setReady,
    ],
  );

  return {
    snapshot,
    getSnapshot,
    playbackClock,
    audioRef,
    queueModel: internalQueueModel,
    publicQueueModel,
    transportModel,
    queueCommands,
    transportCommands,
    shuffle,
    internal,
  };
}
