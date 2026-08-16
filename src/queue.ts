import type { Track } from "./types";

export type ActivatedTrack = {
  queue: Track[];
  currentIndex: number;
};

export function activateTrack(
  queue: Track[],
  currentIndex: number,
  track: Track,
): ActivatedTrack {
  const existingIndex = queue.findIndex((item) => item.id === track.id);
  if (existingIndex >= 0) {
    return { queue, currentIndex: existingIndex };
  }

  const insertionIndex = Math.min(
    Math.max(0, currentIndex + 1),
    queue.length,
  );
  const nextQueue = [...queue];
  nextQueue.splice(insertionIndex, 0, track);
  return { queue: nextQueue, currentIndex: insertionIndex };
}

export function appendUnique(queue: Track[], tracks: Track[]): Track[] {
  const known = new Set(queue.map((track) => track.id));
  const additions = tracks.filter((track) => {
    if (known.has(track.id)) return false;
    known.add(track.id);
    return true;
  });
  return [...queue, ...additions];
}

export function keepCurrentTrack(queue: Track[], currentIndex: number): Track[] {
  const current = queue[currentIndex];
  return current ? [current] : [];
}

export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= items.length ||
    to >= items.length
  ) {
    return items;
  }
  const copy = [...items];
  const [moved] = copy.splice(from, 1);
  copy.splice(to, 0, moved);
  return copy;
}

export function shuffled<T>(items: T[], random = Math.random): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}
