export const MAX_PLAYBACK_POSITION_SECONDS = 7 * 24 * 60 * 60;

export type PlaybackClock = {
  /**
   * Returns the latest media position, including sub-second precision. Use this
   * for persistence, transport decisions, and listened-time accounting.
   */
  readExact: () => number;
  /**
   * Returns the position exposed to React subscribers. Media-driven updates are
   * quantized to whole seconds, while explicit seeks and restores publish their
   * exact position immediately.
   */
  getSnapshot: () => number;
  subscribe: (listener: () => void) => () => void;
  updateFromMedia: (positionSeconds: number) => void;
  seek: (positionSeconds: number) => void;
  restore: (positionSeconds: number) => void;
  reset: () => void;
};

function boundedPosition(positionSeconds: number): number {
  if (!Number.isFinite(positionSeconds)) return 0;
  return Math.min(
    MAX_PLAYBACK_POSITION_SECONDS,
    Math.max(0, positionSeconds),
  );
}

/**
 * Creates an isolated playback clock. Frequent media events update the exact
 * position without forcing the React tree to render more than once per second.
 */
export function createPlaybackClock(initialPositionSeconds = 0): PlaybackClock {
  let exactPosition = boundedPosition(initialPositionSeconds);
  let snapshot = exactPosition;
  let snapshotSecond = Math.floor(exactPosition);
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const publishImmediate = (positionSeconds: number) => {
    const nextPosition = boundedPosition(positionSeconds);
    exactPosition = nextPosition;
    snapshotSecond = Math.floor(nextPosition);
    if (Object.is(snapshot, nextPosition)) return;
    snapshot = nextPosition;
    notify();
  };

  return {
    readExact: () => exactPosition,
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    updateFromMedia: (positionSeconds) => {
      exactPosition = boundedPosition(positionSeconds);
      const nextSecond = Math.floor(exactPosition);
      if (nextSecond === snapshotSecond) return;
      snapshotSecond = nextSecond;
      snapshot = nextSecond;
      notify();
    },
    seek: publishImmediate,
    restore: publishImmediate,
    reset: () => publishImmediate(0),
  };
}
