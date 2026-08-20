import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { ToastNotifier } from "@/components/ui/toastManager";
import { formatErrorMessage } from "@/formatError";
import { createPlaylist } from "@/lib";
import {
  PLAYLISTS_QUERY_KEY,
  playlistQueryKey,
} from "@/queries/savedLibraryQueries";
import type { PlaylistDetail, PlaylistSummary } from "@/types";

import {
  optimisticPlaylistId,
  type PlaylistListMutationContext,
  playlistSummary,
  replaceOptimisticPlaylist,
  restorePlaylistList,
} from "./playlistCache";

export function useCreatePlaylistMutation({
  onCommitted,
  onNotify,
  songIds,
  tracks,
}: {
  onCommitted: (created: PlaylistDetail) => void;
  onNotify: ToastNotifier;
  songIds?: readonly string[];
  tracks?: readonly Readonly<{ duration: number }>[];
}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      createPlaylist(name, songIds ? [...songIds] : []),
    onMutate: async (name): Promise<PlaylistListMutationContext> => {
      await queryClient.cancelQueries({
        queryKey: PLAYLISTS_QUERY_KEY,
        exact: true,
      });
      const previousPlaylists =
        queryClient.getQueryData<PlaylistSummary[]>(PLAYLISTS_QUERY_KEY);
      const optimisticId = optimisticPlaylistId();
      queryClient.setQueryData<PlaylistSummary[]>(
        PLAYLISTS_QUERY_KEY,
        (current) => [
          {
            duration:
              tracks?.reduce((total, track) => total + track.duration, 0) ?? 0,
            id: optimisticId,
            name,
            songCount: songIds?.length ?? 0,
          },
          ...(current ?? []),
        ],
      );
      return { optimisticId, previousPlaylists };
    },
    onSuccess: (created, _name, context) => {
      queryClient.setQueryData(playlistQueryKey(created.id), created);
      queryClient.setQueryData<PlaylistSummary[]>(
        PLAYLISTS_QUERY_KEY,
        (current) =>
          replaceOptimisticPlaylist(
            current,
            context?.optimisticId,
            playlistSummary(created),
          ),
      );
      onCommitted(created);
    },
    onError: (cause, _name, context) => {
      if (context) restorePlaylistList(queryClient, context.previousPlaylists);
      onNotify(formatErrorMessage(cause), "bad");
    },
  });
}
