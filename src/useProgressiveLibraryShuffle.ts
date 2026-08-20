import { useCallback, useEffect, useRef, useState } from "react";
import {
  tracksForScopeAlbum,
  type ArtistGroup,
} from "./libraryBrowse";
import { MAX_PERSISTED_QUEUE_LENGTH } from "./playerState";
import {
  createProgressiveShuffleMaterialization,
  createProgressiveShufflePlan,
  hasProgressiveShuffleSourceResult,
  materializeProgressiveShuffleTracks,
  nextProgressiveShuffleSource,
  progressiveShuffleBatchWaitMs,
  recordProgressiveShuffleSourceResult,
  resolveProgressiveShuffleAdvance,
  shouldFlushProgressiveShuffleTracks,
  shuffleProgressiveAlbumTracks,
  takeProgressiveShuffleTracks,
  type PendingProgressiveShuffleAdvance,
  type ProgressiveShuffleBatchPolicy,
  type ProgressiveShuffleMaterialization,
} from "./progressiveShuffle";
import { appendUnique } from "./queue";
import type { Album, RepeatMode, Track } from "./types";

const REFILL_CONCURRENCY = 4;
const BATCH_POLICY: ProgressiveShuffleBatchPolicy = {
  maxTracks: 64,
  minTracks: 4,
  maxWaitMs: 1_500,
};

type ShuffleSession = {
  connectionGeneration: number;
  scopeName: string;
  artistScope?: ArtistGroup;
  materialization: ProgressiveShuffleMaterialization<Album, Track>;
  albumLoads: Map<string, Promise<void>>;
  recoveredCovers: Map<string, Album>;
  totalAlbums: number;
  cancelled: boolean;
  started: boolean;
  loading?: Promise<void>;
  wakeBatchWait?: () => void;
};

export type ProgressiveLibraryShuffleProgress = {
  done: number;
  total: number;
};

export type ProgressiveLibraryShufflePlayerState = {
  queue: Track[];
  currentIndex: number;
  repeatMode: RepeatMode;
};

export type ProgressiveLibraryShufflePlayerMutation = {
  queue: Track[];
  currentIndex: number;
  playing?: boolean;
  resetPlayback: boolean;
};

type UseProgressiveLibraryShuffleOptions = {
  connected: boolean;
  queue: Track[];
  currentIndex: number;
  playing: boolean;
  getConnectionGeneration: () => number;
  loadAlbumTracks: (album: Album) => Promise<Track[]>;
  recoverAlbum: (album: Album, tracks: readonly Track[]) => Album;
  applyRecoveredAlbums: (albums: ReadonlyMap<string, Album>) => void;
  getPlayerState: () => ProgressiveLibraryShufflePlayerState;
  commitPlayerMutation: (
    mutation: ProgressiveLibraryShufflePlayerMutation,
  ) => void;
  notify: (message: string, tone?: "good" | "bad") => void;
};

export type ProgressiveLibraryShuffleController = {
  activeArtistScopeKey?: string;
  progress?: ProgressiveLibraryShuffleProgress;
  hasMore: boolean;
  cancel: () => void;
  shuffle: (
    albums: readonly Album[],
    scopeName: string,
    artistScope?: ArtistGroup,
  ) => void;
  waitForAdvance: (reason: "ended" | "next") => boolean;
};

export function useProgressiveLibraryShuffle({
  connected,
  queue,
  currentIndex,
  playing,
  getConnectionGeneration,
  loadAlbumTracks,
  recoverAlbum,
  applyRecoveredAlbums,
  getPlayerState,
  commitPlayerMutation,
  notify,
}: UseProgressiveLibraryShuffleOptions): ProgressiveLibraryShuffleController {
  const [progress, setProgress] = useState<
    ProgressiveLibraryShuffleProgress | undefined
  >();
  const [hasMore, setHasMore] = useState(false);
  const [activeArtistScopeKey, setActiveArtistScopeKey] = useState<string>();
  const sessionRef = useRef<ShuffleSession | undefined>(undefined);
  const ownedQueueRef = useRef<Track[] | undefined>(undefined);
  const refillCurrentRef = useRef<() => void>(() => undefined);
  const pendingAdvanceRef = useRef<
    PendingProgressiveShuffleAdvance | undefined
  >(undefined);

  const cancel = useCallback(() => {
    const session = sessionRef.current;
    if (session) {
      session.cancelled = true;
      session.wakeBatchWait?.();
    }
    sessionRef.current = undefined;
    ownedQueueRef.current = undefined;
    pendingAdvanceRef.current = undefined;
    setProgress(undefined);
    setHasMore(false);
    setActiveArtistScopeKey(undefined);
  }, []);

  useEffect(() => () => {
    const session = sessionRef.current;
    if (session) {
      session.cancelled = true;
      session.wakeBatchWait?.();
    }
    sessionRef.current = undefined;
    ownedQueueRef.current = undefined;
    pendingAdvanceRef.current = undefined;
  }, []);

  const refillSession = useCallback((session: ShuffleSession) => {
    if (session.loading || session.cancelled) return;

    const materialization = session.materialization;
    const isCurrentSession = () =>
      !session.cancelled &&
      sessionRef.current === session &&
      getConnectionGeneration() === session.connectionGeneration;

    const flushRecoveredCovers = () => {
      if (!session.recoveredCovers.size || !isCurrentSession()) return;
      const recovered = new Map(session.recoveredCovers);
      session.recoveredCovers.clear();
      applyRecoveredAlbums(recovered);
    };

    const startAlbumLoad = (album: Album): Promise<void> => {
      if (hasProgressiveShuffleSourceResult(materialization, album.id)) {
        return Promise.resolve();
      }
      const existing = session.albumLoads.get(album.id);
      if (existing) return existing;

      let load!: Promise<void>;
      load = loadAlbumTracks(album)
        .then((tracks) => {
          if (!isCurrentSession()) return;
          const recoveredAlbum = recoverAlbum(album, tracks);
          if (recoveredAlbum !== album) {
            session.recoveredCovers.set(album.id, recoveredAlbum);
          }
          const scopedTracks = tracksForScopeAlbum(
            session.artistScope,
            album.id,
            tracks,
          );
          recordProgressiveShuffleSourceResult(
            materialization,
            album.id,
            shuffleProgressiveAlbumTracks(
              scopedTracks,
              materialization.seed,
              album.id,
            ),
          );
        })
        .catch(() => {
          if (!isCurrentSession()) return;
          recordProgressiveShuffleSourceResult(materialization, album.id, []);
        })
        .finally(() => {
          if (session.albumLoads.get(album.id) === load) {
            session.albumLoads.delete(album.id);
          }
          if (isCurrentSession() && !session.started) {
            setProgress({
              done: Math.min(
                materialization.sourceTracks.size,
                session.totalAlbums,
              ),
              total: session.totalAlbums,
            });
          }
        });
      session.albumLoads.set(album.id, load);
      return load;
    };

    const prefetchLookaheadAlbums = () => {
      let available = Math.max(
        0,
        REFILL_CONCURRENCY - session.albumLoads.size,
      );
      if (!available) return;
      const scheduled = new Set<string>();
      for (
        let index = materialization.cursor;
        index < materialization.slots.length;
        index += 1
      ) {
        const album = materialization.slots[index];
        if (
          scheduled.has(album.id) ||
          hasProgressiveShuffleSourceResult(materialization, album.id) ||
          session.albumLoads.has(album.id)
        ) {
          continue;
        }
        scheduled.add(album.id);
        void startAlbumLoad(album);
        available -= 1;
        if (!available) return;
      }
    };

    const waitForAlbumLoad = (
      album: Album,
      maxWaitMs?: number,
    ): Promise<void> => {
      const load = startAlbumLoad(album);
      if (maxWaitMs === undefined) return load;
      if (maxWaitMs <= 0) return Promise.resolve();
      return new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          if (session.wakeBatchWait === finish) {
            session.wakeBatchWait = undefined;
          }
          window.clearTimeout(timer);
          resolve();
        };
        const timer = window.setTimeout(finish, maxWaitMs);
        session.wakeBatchWait = finish;
        void load.then(finish);
      });
    };

    const prepareBufferedTracks = async (): Promise<void> => {
      while (isCurrentSession()) {
        prefetchLookaheadAlbums();
        const now = Date.now();
        materializeProgressiveShuffleTracks(
          materialization,
          MAX_PERSISTED_QUEUE_LENGTH,
          now,
          BATCH_POLICY.maxTracks,
        );
        const advancePending = Boolean(pendingAdvanceRef.current);
        if (
          shouldFlushProgressiveShuffleTracks(
            materialization,
            BATCH_POLICY,
            { now, started: session.started, advancePending },
          ) ||
          materialization.exhausted
        ) {
          return;
        }

        const nextAlbum = nextProgressiveShuffleSource(materialization);
        if (!nextAlbum) return;
        const canWaitForBatch =
          session.started &&
          materialization.bufferedTracks.length > 0 &&
          !advancePending;
        const batchWaitMs = canWaitForBatch
          ? progressiveShuffleBatchWaitMs(
              materialization,
              BATCH_POLICY,
              now,
            )
          : undefined;
        await waitForAlbumLoad(nextAlbum, batchWaitMs);
      }
    };

    const settleExhaustedSession = () => {
      if (
        !isCurrentSession() ||
        !materialization.exhausted ||
        materialization.bufferedTracks.length
      ) {
        return false;
      }
      const pendingAdvance = pendingAdvanceRef.current;
      pendingAdvanceRef.current = undefined;
      sessionRef.current = undefined;
      ownedQueueRef.current = undefined;
      setProgress(undefined);
      setHasMore(false);
      setActiveArtistScopeKey(undefined);
      if (!session.started) {
        notify("Bandcamp did not return any playable tracks.", "bad");
      } else if (pendingAdvance) {
        const latest = getPlayerState();
        const resolution = resolveProgressiveShuffleAdvance(
          latest.queue,
          latest.currentIndex,
          pendingAdvance,
          latest.repeatMode,
          true,
        );
        if (resolution.status === "resolved") {
          const changedTrack = resolution.currentIndex !== latest.currentIndex;
          commitPlayerMutation({
            queue: latest.queue,
            currentIndex: resolution.currentIndex,
            playing: resolution.playing,
            resetPlayback: changedTrack,
          });
        }
      }
      return true;
    };

    let committedQueueUpdate = false;
    let request!: Promise<void>;
    request = (async () => {
      await prepareBufferedTracks();
      if (!isCurrentSession()) return;
      flushRecoveredCovers();
      const now = Date.now();
      const advancePending = Boolean(pendingAdvanceRef.current);
      const shouldFlush = shouldFlushProgressiveShuffleTracks(
        materialization,
        BATCH_POLICY,
        { now, started: session.started, advancePending },
      );
      const tracks = shouldFlush
        ? takeProgressiveShuffleTracks(
            materialization,
            BATCH_POLICY.maxTracks,
            now,
          )
        : [];
      if (tracks.length) {
        if (!session.started) {
          session.started = true;
          setHasMore(!materialization.exhausted);
          ownedQueueRef.current = tracks;
          commitPlayerMutation({
            queue: tracks,
            currentIndex: 0,
            playing: true,
            resetPlayback: true,
          });
          committedQueueUpdate = true;
          setProgress(undefined);
          notify(`Shuffling ${session.scopeName}`, "good");
        } else {
          const current = getPlayerState();
          if (ownedQueueRef.current !== current.queue) {
            session.cancelled = true;
            return;
          }
          const nextQueue = appendUnique(current.queue, tracks);
          const pendingAdvance = pendingAdvanceRef.current;
          const advance = resolveProgressiveShuffleAdvance(
            nextQueue,
            current.currentIndex,
            pendingAdvance,
            current.repeatMode,
            materialization.exhausted,
          );
          const nextIndex = advance.status === "resolved"
            ? advance.currentIndex
            : current.currentIndex;
          if (advance.status === "resolved") {
            pendingAdvanceRef.current = undefined;
          }
          ownedQueueRef.current = nextQueue;
          commitPlayerMutation({
            queue: nextQueue,
            currentIndex: nextIndex,
            playing: advance.status === "resolved"
              ? advance.playing
              : undefined,
            resetPlayback:
              advance.status === "resolved" &&
              nextIndex !== current.currentIndex,
          });
          committedQueueUpdate = true;
        }
      }
      settleExhaustedSession();
    })()
      .catch(() => {
        if (isCurrentSession() && !session.started) {
          notify("Bandcamp did not return any playable tracks.", "bad");
          cancel();
        }
      })
      .finally(() => {
        if (session.loading === request) session.loading = undefined;
        if (!isCurrentSession() || settleExhaustedSession()) return;
        if (session.started && committedQueueUpdate) return;
        window.setTimeout(() => {
          if (isCurrentSession()) refillCurrentRef.current();
        }, 0);
      });
    session.loading = request;
  }, [
    applyRecoveredAlbums,
    cancel,
    commitPlayerMutation,
    getConnectionGeneration,
    getPlayerState,
    loadAlbumTracks,
    notify,
    recoverAlbum,
  ]);

  refillCurrentRef.current = () => {
    const session = sessionRef.current;
    if (session) refillSession(session);
  };

  useEffect(() => {
    const session = sessionRef.current;
    const ownedQueue = ownedQueueRef.current;
    if (session?.started && ownedQueue && queue !== ownedQueue) {
      cancel();
      return;
    }
    const pendingAdvance = pendingAdvanceRef.current;
    if (
      pendingAdvance &&
      (
        pendingAdvance.currentIndex !== currentIndex ||
        pendingAdvance.trackId !== queue[currentIndex]?.id
      )
    ) {
      pendingAdvanceRef.current = undefined;
    }
    if (session?.started && ownedQueue === queue) {
      const timer = window.setTimeout(() => {
        if (
          sessionRef.current === session &&
          ownedQueueRef.current === queue
        ) {
          refillCurrentRef.current();
        }
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [cancel, currentIndex, queue]);

  useEffect(() => {
    if (!playing) pendingAdvanceRef.current = undefined;
  }, [playing]);

  const shuffle = useCallback((
    scopeAlbums: readonly Album[],
    scopeName: string,
    artistScope?: ArtistGroup,
  ) => {
    if (!connected || !scopeAlbums.length) return;
    cancel();
    const plan = createProgressiveShufflePlan(
      scopeAlbums,
      MAX_PERSISTED_QUEUE_LENGTH,
    );
    const session: ShuffleSession = {
      connectionGeneration: getConnectionGeneration(),
      scopeName,
      artistScope,
      materialization: createProgressiveShuffleMaterialization<Album, Track>(
        plan,
      ),
      albumLoads: new Map(),
      recoveredCovers: new Map(),
      totalAlbums: new Set(scopeAlbums.map((album) => album.id)).size,
      cancelled: false,
      started: false,
    };
    sessionRef.current = session;
    setActiveArtistScopeKey(artistScope?.key);
    setProgress({ done: 0, total: session.totalAlbums });
    refillSession(session);
  }, [cancel, connected, getConnectionGeneration, refillSession]);

  const waitForAdvance = useCallback((reason: "ended" | "next") => {
    const session = sessionRef.current;
    const latest = getPlayerState();
    const current = latest.queue[latest.currentIndex];
    if (
      !session ||
      session.cancelled ||
      !current ||
      ownedQueueRef.current !== latest.queue ||
      session.materialization.exhausted
    ) {
      return false;
    }
    pendingAdvanceRef.current = {
      currentIndex: latest.currentIndex,
      trackId: current.id,
      reason,
      wasPlaying: reason === "ended" ? true : playing,
    };
    session.wakeBatchWait?.();
    refillCurrentRef.current();
    return true;
  }, [getPlayerState, playing]);

  return {
    activeArtistScopeKey,
    progress,
    hasMore,
    cancel,
    shuffle,
    waitForAdvance,
  };
}
