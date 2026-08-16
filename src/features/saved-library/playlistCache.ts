import type { QueryClient } from "@tanstack/react-query";

import {
  PLAYLISTS_QUERY_KEY,
  playlistQueryKey,
} from "@/queries/savedLibraryQueries";
import type { PlaylistDetail, PlaylistSummary, Track } from "@/types";

export type PlaylistListMutationContext = {
  optimisticId?: string;
  previousPlaylists?: PlaylistSummary[];
};

export type PlaylistDetailMutationContext = PlaylistListMutationContext & {
  previousPlaylist?: PlaylistDetail;
};

export function playlistSummary(
  playlist: PlaylistDetail,
): PlaylistSummary {
  const { tracks: _tracks, ...summary } = playlist;
  return summary;
}

export function upsertPlaylistSummary(
  playlists: PlaylistSummary[] | undefined,
  playlist: PlaylistSummary,
): PlaylistSummary[] {
  const current = playlists ?? [];
  const existing = current.findIndex((item) => item.id === playlist.id);
  if (existing < 0) return [playlist, ...current];
  return current.map((item, index) => (index === existing ? playlist : item));
}

export function replaceOptimisticPlaylist(
  playlists: PlaylistSummary[] | undefined,
  optimisticId: string | undefined,
  playlist: PlaylistSummary,
): PlaylistSummary[] {
  if (!optimisticId) return upsertPlaylistSummary(playlists, playlist);
  const current = playlists ?? [];
  const optimisticIndex = current.findIndex(
    (item) => item.id === optimisticId,
  );
  if (optimisticIndex < 0) return upsertPlaylistSummary(current, playlist);
  return current.map((item, index) =>
    index === optimisticIndex ? playlist : item,
  );
}

export function optimisticPlaylistId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  return `optimistic:${randomId ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

export function isOptimisticPlaylist(playlist: PlaylistSummary): boolean {
  return playlist.id.startsWith("optimistic:");
}

export function restorePlaylistList(
  queryClient: QueryClient,
  previousPlaylists: PlaylistSummary[] | undefined,
): void {
  if (previousPlaylists === undefined) {
    queryClient.removeQueries({
      queryKey: PLAYLISTS_QUERY_KEY,
      exact: true,
    });
    return;
  }
  queryClient.setQueryData(PLAYLISTS_QUERY_KEY, previousPlaylists);
}

export function restorePlaylistMutation(
  queryClient: QueryClient,
  playlistId: string,
  context: PlaylistDetailMutationContext,
): void {
  restorePlaylistList(queryClient, context.previousPlaylists);
  const detailKey = playlistQueryKey(playlistId);
  if (context.previousPlaylist === undefined) {
    queryClient.removeQueries({ queryKey: detailKey, exact: true });
    return;
  }
  queryClient.setQueryData(detailKey, context.previousPlaylist);
}

export function revalidateCommittedPlaylist(
  queryClient: QueryClient,
  playlistId: string,
): void {
  void queryClient.invalidateQueries({
    queryKey: playlistQueryKey(playlistId),
    exact: true,
  });
  void queryClient.invalidateQueries({
    queryKey: PLAYLISTS_QUERY_KEY,
    exact: true,
    refetchType: "none",
  });
}

export function removedPlaylistTracks(
  playlist: PlaylistDetail,
  indexes: readonly number[],
): PlaylistDetail {
  const removals = new Set(
    indexes.filter((index) => Number.isInteger(index) && index >= 0),
  );
  const tracks = playlist.tracks.filter(
    (_track, index) => !removals.has(index),
  );
  return {
    ...playlist,
    duration: tracks.reduce((total, track) => total + track.duration, 0),
    songCount: tracks.length,
    tracks,
  };
}

export function addedPlaylistTracks(
  playlist: PlaylistDetail,
  tracksToAdd: readonly Track[],
): PlaylistDetail {
  const existing = new Set(playlist.tracks.map((track) => track.id));
  const additions = tracksToAdd.filter((track) => {
    if (existing.has(track.id)) return false;
    existing.add(track.id);
    return true;
  });
  const tracks = [...playlist.tracks, ...additions];
  return {
    ...playlist,
    duration: tracks.reduce((total, track) => total + track.duration, 0),
    songCount: tracks.length,
    tracks,
  };
}
