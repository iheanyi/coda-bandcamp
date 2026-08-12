const UINT32_RANGE = 0x1_0000_0000;

type ShuffleSource = {
  id: string;
  songCount: number;
};

export interface ProgressiveShufflePlan<TSource> {
  seed: number;
  slots: TSource[];
}

type Identified = {
  id: string;
};

export interface ProgressiveShuffleMaterialization<
  TSource extends Identified,
  TTrack extends Identified,
> {
  seed: number;
  slots: TSource[];
  cursor: number;
  sourceTracks: Map<string, TTrack[]>;
  sourceTrackIndexes: Map<string, number>;
  remainingSourceSlots: Map<string, number>;
  knownTrackIds: Set<string>;
  bufferedTracks: TTrack[];
  bufferedSince?: number;
  exhausted: boolean;
}

export interface ProgressiveShuffleBatchPolicy {
  maxTracks: number;
  minTracks: number;
  maxWaitMs: number;
}

export interface PendingProgressiveShuffleAdvance {
  currentIndex: number;
  trackId: string;
  reason: "ended" | "next";
  wasPlaying: boolean;
}

export type ProgressiveShuffleAdvanceResolution =
  | { status: "waiting" }
  | {
      status: "resolved";
      currentIndex: number;
      playing: boolean;
    };

function unitInterval(random: () => number): number {
  const value = random();
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1 - Number.EPSILON);
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / UINT32_RANGE;
  };
}

function albumSeed(seed: number, albumId: string): number {
  let hash = (2166136261 ^ seed) >>> 0;
  for (let index = 0; index < albumId.length; index += 1) {
    hash = Math.imul(hash ^ albumId.charCodeAt(index), 16777619) >>> 0;
  }
  return hash;
}

function shuffleWithRandom<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(unitInterval(random) * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function addWeight(tree: Float64Array, index: number, change: number): void {
  for (let cursor = index + 1; cursor < tree.length; cursor += cursor & -cursor) {
    tree[cursor] += change;
  }
}

function sourceIndexAtWeight(tree: Float64Array, target: number): number {
  let index = 0;
  let step = 1;
  while ((step << 1) < tree.length) step <<= 1;
  for (; step > 0; step >>= 1) {
    const candidate = index + step;
    if (candidate < tree.length && tree[candidate] <= target) {
      index = candidate;
      target -= tree[candidate];
    }
  }
  return Math.min(index, tree.length - 2);
}

/**
 * Builds a bounded, song-count-weighted shuffle before hydration begins.
 * Network completion cannot affect this order because the plan consumes only
 * one caller-supplied random value and then uses its own deterministic stream.
 */
export function createProgressiveShufflePlan<TSource extends ShuffleSource>(
  sources: readonly TSource[],
  maxTracks: number,
  random: () => number = Math.random,
): ProgressiveShufflePlan<TSource> {
  const limit = Math.max(
    0,
    Number.isFinite(maxTracks) ? Math.floor(maxTracks) : 0,
  );
  const seed = Math.floor(unitInterval(random) * UINT32_RANGE) >>> 0;
  if (!sources.length || !limit) return { seed, slots: [] };

  const weights = sources.map((source) =>
    Math.min(limit, Math.max(1, Math.floor(source.songCount) || 1))
  );
  const tree = new Float64Array(sources.length + 1);
  let remainingWeight = 0;
  for (let index = 0; index < weights.length; index += 1) {
    addWeight(tree, index, weights[index]);
    remainingWeight += weights[index];
  }

  const nextRandom = seededRandom(seed);
  const slots: TSource[] = [];
  while (slots.length < limit && remainingWeight > 0) {
    const target = nextRandom() * remainingWeight;
    const sourceIndex = sourceIndexAtWeight(tree, target);
    slots.push(sources[sourceIndex]);
    weights[sourceIndex] -= 1;
    remainingWeight -= 1;
    addWeight(tree, sourceIndex, -1);
  }
  return { seed, slots };
}

/** Keeps an album's internal track order stable regardless of fetch timing. */
export function shuffleProgressiveAlbumTracks<T>(
  tracks: readonly T[],
  planSeed: number,
  albumId: string,
): T[] {
  return shuffleWithRandom(tracks, seededRandom(albumSeed(planSeed, albumId)));
}

export function createProgressiveShuffleMaterialization<
  TSource extends Identified,
  TTrack extends Identified,
>(plan: ProgressiveShufflePlan<TSource>): ProgressiveShuffleMaterialization<
  TSource,
  TTrack
> {
  const remainingSourceSlots = new Map<string, number>();
  for (const source of plan.slots) {
    remainingSourceSlots.set(
      source.id,
      (remainingSourceSlots.get(source.id) ?? 0) + 1,
    );
  }
  return {
    seed: plan.seed,
    slots: plan.slots,
    cursor: 0,
    sourceTracks: new Map(),
    sourceTrackIndexes: new Map(),
    remainingSourceSlots,
    knownTrackIds: new Set(),
    bufferedTracks: [],
    exhausted: plan.slots.length === 0,
  };
}

export function hasProgressiveShuffleSourceResult<
  TSource extends Identified,
  TTrack extends Identified,
>(
  materialization: ProgressiveShuffleMaterialization<TSource, TTrack>,
  sourceId: string,
): boolean {
  return materialization.sourceTracks.has(sourceId);
}

export function recordProgressiveShuffleSourceResult<
  TSource extends Identified,
  TTrack extends Identified,
>(
  materialization: ProgressiveShuffleMaterialization<TSource, TTrack>,
  sourceId: string,
  tracks: readonly TTrack[],
): void {
  if (materialization.sourceTracks.has(sourceId)) return;
  materialization.sourceTracks.set(sourceId, [...tracks]);
  materialization.sourceTrackIndexes.set(sourceId, 0);
}

export function nextProgressiveShuffleSource<
  TSource extends Identified,
  TTrack extends Identified,
>(
  materialization: ProgressiveShuffleMaterialization<TSource, TTrack>,
): TSource | undefined {
  return materialization.slots[materialization.cursor];
}

/**
 * Moves every currently ordered and hydrated track into a bounded buffer.
 * A missing source result is a hard ordering boundary: later network results
 * cannot perturb the deterministic plan.
 */
export function materializeProgressiveShuffleTracks<
  TSource extends Identified,
  TTrack extends Identified,
>(
  materialization: ProgressiveShuffleMaterialization<TSource, TTrack>,
  maxTracks: number,
  now: number,
  maxBufferedTracks = Number.POSITIVE_INFINITY,
): number {
  const safeLimit = Math.max(0, Math.floor(maxTracks));
  const safeBufferLimit = Math.max(0, Math.floor(maxBufferedTracks));
  const initialBufferLength = materialization.bufferedTracks.length;
  while (
    materialization.cursor < materialization.slots.length &&
    materialization.knownTrackIds.size < safeLimit &&
    materialization.bufferedTracks.length < safeBufferLimit
  ) {
    const source = materialization.slots[materialization.cursor];
    if (!materialization.sourceTracks.has(source.id)) break;

    materialization.cursor += 1;
    const sourceTracks = materialization.sourceTracks.get(source.id) ?? [];
    const trackIndex = materialization.sourceTrackIndexes.get(source.id) ?? 0;
    materialization.sourceTrackIndexes.set(source.id, trackIndex + 1);

    const remainingSlots =
      (materialization.remainingSourceSlots.get(source.id) ?? 1) - 1;
    if (remainingSlots > 0) {
      materialization.remainingSourceSlots.set(source.id, remainingSlots);
    } else {
      materialization.remainingSourceSlots.delete(source.id);
      materialization.sourceTracks.delete(source.id);
      materialization.sourceTrackIndexes.delete(source.id);
    }

    const track = sourceTracks[trackIndex];
    if (!track || materialization.knownTrackIds.has(track.id)) continue;
    materialization.knownTrackIds.add(track.id);
    materialization.bufferedTracks.push(track);
  }

  materialization.exhausted =
    materialization.cursor >= materialization.slots.length ||
    materialization.knownTrackIds.size >= safeLimit;
  const added = materialization.bufferedTracks.length - initialBufferLength;
  if (added > 0 && materialization.bufferedSince === undefined) {
    materialization.bufferedSince = now;
  }
  return added;
}

export function shouldFlushProgressiveShuffleTracks<
  TSource extends Identified,
  TTrack extends Identified,
>(
  materialization: ProgressiveShuffleMaterialization<TSource, TTrack>,
  policy: ProgressiveShuffleBatchPolicy,
  options: {
    now: number;
    started: boolean;
    advancePending: boolean;
  },
): boolean {
  if (!materialization.bufferedTracks.length) return false;
  if (!options.started || options.advancePending || materialization.exhausted) {
    return true;
  }
  if (materialization.bufferedTracks.length >= policy.maxTracks) return true;
  if (materialization.bufferedTracks.length >= policy.minTracks) return true;
  return materialization.bufferedSince !== undefined &&
    options.now - materialization.bufferedSince >= policy.maxWaitMs;
}

export function progressiveShuffleBatchWaitMs<
  TSource extends Identified,
  TTrack extends Identified,
>(
  materialization: ProgressiveShuffleMaterialization<TSource, TTrack>,
  policy: ProgressiveShuffleBatchPolicy,
  now: number,
): number | undefined {
  if (
    !materialization.bufferedTracks.length ||
    materialization.bufferedSince === undefined
  ) {
    return undefined;
  }
  return Math.max(
    0,
    policy.maxWaitMs - (now - materialization.bufferedSince),
  );
}

export function takeProgressiveShuffleTracks<
  TSource extends Identified,
  TTrack extends Identified,
>(
  materialization: ProgressiveShuffleMaterialization<TSource, TTrack>,
  maxTracks: number,
  now: number,
): TTrack[] {
  const count = Math.max(0, Math.floor(maxTracks));
  const tracks = materialization.bufferedTracks.splice(0, count);
  materialization.bufferedSince = materialization.bufferedTracks.length
    ? now
    : undefined;
  return tracks;
}

/** Resolves an advance only after a next track arrives or the plan exhausts. */
export function resolveProgressiveShuffleAdvance<TTrack extends Identified>(
  queue: readonly TTrack[],
  currentIndex: number,
  pending: PendingProgressiveShuffleAdvance | undefined,
  repeatMode: "off" | "all" | "one",
  exhausted: boolean,
): ProgressiveShuffleAdvanceResolution {
  if (!pending) return { status: "waiting" };
  const current = queue[currentIndex];
  if (
    pending.currentIndex !== currentIndex ||
    pending.trackId !== current?.id
  ) {
    return { status: "waiting" };
  }

  if (currentIndex + 1 < queue.length) {
    return {
      status: "resolved",
      currentIndex: currentIndex + 1,
      playing: pending.reason === "ended" ? true : pending.wasPlaying,
    };
  }
  if (!exhausted) return { status: "waiting" };

  if (repeatMode === "all" && queue.length > 1) {
    return {
      status: "resolved",
      currentIndex: 0,
      playing: pending.reason === "ended" ? true : pending.wasPlaying,
    };
  }
  return {
    status: "resolved",
    currentIndex,
    playing: pending.reason === "ended" ? false : pending.wasPlaying,
  };
}
