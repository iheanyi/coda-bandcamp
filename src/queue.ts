import type { Track } from "./types";

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
