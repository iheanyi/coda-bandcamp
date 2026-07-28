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

export const bandcampQueryKey = ["bandcamp"] as const;
export const libraryQueryKey = [...bandcampQueryKey, "library"] as const;
export const LIBRARY_AUTO_REVALIDATE_INTERVAL_MS = 15 * 60 * 1_000;
const ALBUM_QUERY_STALE_TIME_MS = 10 * 60 * 1_000;
const ALBUM_QUERY_GC_TIME_MS = 30 * 60 * 1_000;

export const libraryStateQueryOptions = queryOptions({
  queryKey: libraryQueryKey,
  queryFn: async (): Promise<Album[]> => [],
  initialData: [] as Album[],
  enabled: false,
  gcTime: Infinity,
  staleTime: Infinity,
});

export function albumQueryKey(albumId: string) {
  return [...bandcampQueryKey, "album", albumId] as const;
}

function albumRefreshQueryKey(albumId: string) {
  return [...albumQueryKey(albumId), "refresh"] as const;
}

export function albumQueryOptions(album: Album) {
  return queryOptions({
    queryKey: albumQueryKey(album.id),
    queryFn: (): Promise<Track[]> => fetchAlbum(album),
    gcTime: ALBUM_QUERY_GC_TIME_MS,
    staleTime: ALBUM_QUERY_STALE_TIME_MS,
  });
}

export function cachedAlbumTracks(
  queryClient: QueryClient,
  album: Album,
): Track[] | undefined {
  if (album.tracks !== undefined) return album.tracks;
  return queryClient.getQueryData<Track[]>(albumQueryKey(album.id));
}

function seedLocalAlbumTracks(queryClient: QueryClient, album: Album): boolean {
  const queryKey = albumQueryKey(album.id);
  if (
    queryClient.getQueryData<Track[]>(queryKey) === undefined &&
    album.tracks?.length
  ) {
    // Detail views can render restored/favorite metadata immediately. Their
    // explicit revalidation path refreshes this zero-timestamp seed once.
    queryClient.setQueryData(queryKey, album.tracks, { updatedAt: 0 });
    return true;
  }
  return false;
}

export function ensureAlbumQueryData(
  queryClient: QueryClient,
  album: Album,
): Promise<Track[]> {
  if (seedLocalAlbumTracks(queryClient, album)) {
    return Promise.resolve(album.tracks!);
  }
  return queryClient.ensureQueryData({
    ...albumQueryOptions(album),
    revalidateIfStale: true,
  });
}

export async function prefetchAlbumQueryData(
  queryClient: QueryClient,
  album: Album,
): Promise<void> {
  if (seedLocalAlbumTracks(queryClient, album)) return;
  await queryClient.prefetchQuery(albumQueryOptions(album));
}

async function invalidateAlbumQuery(
  queryClient: QueryClient,
  album: Album,
): Promise<void> {
  await queryClient.invalidateQueries({
    queryKey: albumQueryKey(album.id),
    exact: true,
    refetchType: "none",
  });
}

export async function revalidateAlbumQueryData(
  queryClient: QueryClient,
  album: Album,
): Promise<Track[]> {
  seedLocalAlbumTracks(queryClient, album);
  await invalidateAlbumQuery(queryClient, album);
  return queryClient.fetchQuery(albumQueryOptions(album));
}

export async function refreshAlbumQueryData(
  queryClient: QueryClient,
  album: Album,
): Promise<Track[]> {
  const refreshKey = albumRefreshQueryKey(album.id);
  try {
    const tracks = await queryClient.fetchQuery({
      queryKey: refreshKey,
      queryFn: () => fetchAlbum(album, { forceRefresh: true }),
      gcTime: 0,
      staleTime: Infinity,
    });
    queryClient.setQueryData(albumQueryKey(album.id), tracks);
    return tracks;
  } finally {
    queryClient.removeQueries({ queryKey: refreshKey, exact: true });
  }
}

export function clearBandcampQueryData(queryClient: QueryClient): void {
  queryClient.removeQueries({ queryKey: bandcampQueryKey });
}

export function updateLibraryData(
  queryClient: QueryClient,
  update: SetStateAction<Album[]>,
): Album[] {
  let next: Album[] = [];
  queryClient.setQueryData<Album[]>(libraryQueryKey, (current = []) => {
    const updated = typeof update === "function" ? update(current) : update;
    next = toLibrarySummaries(updated);
    return next;
  });
  return next;
}

export function toLibrarySummaries(albums: readonly Album[]): Album[] {
  return albums.map((album) => {
    if (!album.tracks) return album;
    const { tracks: _tracks, ...summary } = album;
    return summary;
  });
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
