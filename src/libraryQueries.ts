import {
  queryOptions,
  type QueryClient,
} from "@tanstack/react-query";
import type { SetStateAction } from "react";
import {
  fetchAlbum,
  loadLibraryCache,
  type LibraryCacheSnapshot,
  type LibrarySyncProgress,
} from "./lib";
import type { Album, Track } from "./types";

export const libraryQueryKey = ["bandcamp", "library"] as const;
export const LIBRARY_AUTO_REVALIDATE_INTERVAL_MS = 15 * 60 * 1_000;

export const libraryStateQueryOptions = queryOptions({
  queryKey: libraryQueryKey,
  queryFn: async (): Promise<Album[]> => [],
  initialData: [] as Album[],
  enabled: false,
  gcTime: Infinity,
  staleTime: Infinity,
});

export function albumQueryOptions(album: Album) {
  return queryOptions({
    queryKey: ["bandcamp", "album", album.id] as const,
    queryFn: (): Promise<Track[]> => fetchAlbum(album),
    gcTime: 30 * 60 * 1_000,
    staleTime: 10 * 60 * 1_000,
  });
}

export function updateLibraryData(
  queryClient: QueryClient,
  update: SetStateAction<Album[]>,
): Album[] {
  let next: Album[] = [];
  queryClient.setQueryData<Album[]>(libraryQueryKey, (current = []) => {
    next = typeof update === "function" ? update(current) : update;
    return next;
  });
  return next;
}

export async function hydrateLibraryQuery(
): Promise<LibraryCacheSnapshot | undefined> {
  return loadLibraryCache();
}

export function shouldAutoRevalidateLibrary(
  snapshot: LibraryCacheSnapshot | undefined,
  now = Date.now(),
): boolean {
  if (!snapshot?.albums.length) return true;
  if (!Number.isFinite(snapshot.savedAt) || snapshot.savedAt > now) return true;
  return now - snapshot.savedAt >= LIBRARY_AUTO_REVALIDATE_INTERVAL_MS;
}

export function mergeLibraryProgress(
  current: readonly Album[],
  progress: LibrarySyncProgress,
): Album[] {
  if (!progress.albums.length) return current as Album[];
  const incoming = new Map(progress.albums.map((album) => [album.id, album]));
  const merged = current.map((album) => incoming.get(album.id) ?? album);
  const known = new Set(current.map((album) => album.id));
  for (const album of progress.albums) {
    if (!known.has(album.id)) merged.push(album);
  }
  return merged;
}
