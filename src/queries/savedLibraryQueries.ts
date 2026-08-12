import { queryOptions } from "@tanstack/react-query";
import { fetchPlaylist, fetchPlaylists } from "@/lib";

export const PLAYLISTS_QUERY_KEY = ["bandcamp", "playlists"] as const;

export function playlistQueryKey(playlistId: string) {
  return [...PLAYLISTS_QUERY_KEY, playlistId] as const;
}

export function playlistsQueryOptions() {
  return queryOptions({
    queryKey: PLAYLISTS_QUERY_KEY,
    queryFn: fetchPlaylists,
  });
}

export function playlistQueryOptions(playlistId: string) {
  return queryOptions({
    queryKey: playlistQueryKey(playlistId),
    queryFn: () => fetchPlaylist(playlistId),
  });
}
