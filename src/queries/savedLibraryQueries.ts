import { queryOptions } from "@tanstack/react-query";
import { fetchPlaylist, fetchPlaylists } from "@/lib";

export const PLAYLISTS_QUERY_KEY = ["bandcamp", "playlists"] as const;
export const PLAYLIST_STALE_TIME_MS = 5 * 60 * 1_000;

export function playlistQueryKey(playlistId: string) {
  return [...PLAYLISTS_QUERY_KEY, playlistId] as const;
}

export function playlistsQueryOptions() {
  return queryOptions({
    queryKey: PLAYLISTS_QUERY_KEY,
    queryFn: fetchPlaylists,
    staleTime: PLAYLIST_STALE_TIME_MS,
  });
}

export function playlistQueryOptions(playlistId: string) {
  return queryOptions({
    queryKey: playlistQueryKey(playlistId),
    queryFn: () => fetchPlaylist(playlistId),
    staleTime: PLAYLIST_STALE_TIME_MS,
  });
}
