const UINT32_RANGE = 0x1_0000_0000;

type ShuffleSource = {
  id: string;
  songCount: number;
};

export interface ProgressiveShufflePlan<TSource> {
  seed: number;
  slots: TSource[];
}

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
