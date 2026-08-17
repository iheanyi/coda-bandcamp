import { ListMusic, RefreshCw } from "lucide-react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { RouteCommitOutcome } from "@/features/navigation/routeCommit";
import { useActivateDetailDestination } from "@/features/navigation/useActivateDetailDestination";
import { createPlaylist, deletePlaylist, updatePlaylist } from "@/lib";
import { cn } from "@/lib/utils";
import {
  PLAYLISTS_QUERY_KEY,
  playlistQueryKey,
  playlistQueryOptions,
  playlistsQueryOptions,
} from "@/queries/savedLibraryQueries";
import { type PlaylistId } from "@/routing/routeContracts";
import type {
  PlaylistDetail,
  PlaylistSummary,
  PlaylistUpdateInput,
} from "@/types";

import {
  optimisticPlaylistId,
  type PlaylistDetailMutationContext,
  type PlaylistListMutationContext,
  playlistSummary,
  removedPlaylistTracks,
  replaceOptimisticPlaylist,
  restorePlaylistList,
  restorePlaylistMutation,
  revalidateCommittedPlaylist,
  upsertPlaylistSummary,
} from "./playlistCache";
import { PlaylistDetailView } from "./PlaylistDetailView";
import { PlaylistList } from "./PlaylistList";
import {
  mutationError,
  savedPageClassName,
} from "./savedLibraryPresentationData";
import { SavedEmpty, Eyebrow } from "./SavedLibraryPresentation";
import type { PlaylistsControllerProps } from "./savedLibraryTypes";

function assertNever(value: never): never {
  throw new TypeError(`Unsupported exhaustive variant: ${String(value)}`);
}

function playlistNavigationSucceeded(outcome: RouteCommitOutcome): boolean {
  switch (outcome) {
    case "rendered":
    case "same-location":
      return true;
    case "failed":
    case "timeout":
      return false;
    default:
      return assertNever(outcome);
  }
}

function playlistNavigationFailureCopy(
  outcome: "failed" | "timeout",
): string {
  switch (outcome) {
    case "failed":
      return "Playlist navigation failed. Try again.";
    case "timeout":
      return "Playlist navigation took too long. Try again.";
    default:
      return assertNever(outcome);
  }
}

export function PlaylistsController(props: PlaylistsControllerProps) {
  const { className, connected, onNotify } = props;
  const selectedPlaylistId =
    props.screen === "detail" ? props.playlistId : undefined;
  const queryClient = useQueryClient();
  const routeNavigate = useNavigate();
  const [openingPlaylistId, setOpeningPlaylistId] = useState<string>();
  const replacePlaylistsIndex = () =>
    routeNavigate({
      replace: true,
      to: "/playlists",
      viewTransition: false,
    });
  const runPlaylistNavigation = async (
    commit: () => Promise<RouteCommitOutcome>,
    onSettled?: () => void,
    recover?: () => Promise<RouteCommitOutcome>,
  ): Promise<void> => {
    const recoverOrReplace = async (): Promise<boolean> => {
      if (!recover) return false;
      try {
        const recovered = await recover();
        if (playlistNavigationSucceeded(recovered)) return true;
      } catch {
        // The transitioned replacement failed; use a transition-free replace.
      }
      await replacePlaylistsIndex();
      return true;
    };
    try {
      const outcome = await commit();
      if (playlistNavigationSucceeded(outcome)) return;
      try {
        if (await recoverOrReplace()) return;
      } catch (recoveryCause) {
        onNotify(mutationError(recoveryCause), "bad");
        return;
      }
      if (outcome === "failed" || outcome === "timeout") {
        onNotify(playlistNavigationFailureCopy(outcome), "bad");
      }
    } catch (cause) {
      if (recover) {
        try {
          if (await recoverOrReplace()) return;
        } catch (recoveryCause) {
          onNotify(mutationError(recoveryCause), "bad");
          return;
        }
      }
      onNotify(mutationError(cause), "bad");
    } finally {
      onSettled?.();
    }
  };
  const closePlaylist = () => {
    if (props.screen !== "detail") return;
    void runPlaylistNavigation(() => props.onBack());
  };
  const playlists = useQuery({
    ...playlistsQueryOptions(),
    enabled: connected && props.screen === "index",
  });
  const playlist = useQuery({
    ...playlistQueryOptions(selectedPlaylistId ?? ""),
    enabled: connected && Boolean(selectedPlaylistId),
  });

  useActivateDetailDestination(
    "playlist",
    `playlist:${selectedPlaylistId ?? ""}`,
    Boolean(
      selectedPlaylistId && playlist.data?.id === selectedPlaylistId,
    ),
  );
  const createMutation = useMutation({
    mutationFn: (name: string) => createPlaylist(name),
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
            duration: 0,
            id: optimisticId,
            name,
            songCount: 0,
          },
          ...(current ?? []),
        ],
      );
      return { optimisticId, previousPlaylists };
    },
    onSuccess: (created, _name, context) => {
      // SAFETY: createPlaylist decodes the id through parseNativePlaylistSummary.
      const createdPlaylistId = created.id as PlaylistId;
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
      if (props.screen === "index") {
        void runPlaylistNavigation(() =>
          props.onOpenPlaylist({
            playlistId: createdPlaylistId,
            sharedIdentityAvailable: false,
            sourceTrigger:
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : undefined,
          }),
        );
      }
      onNotify(`${created.name} created`, "good");
    },
    onError: (cause, _name, context) => {
      if (context) restorePlaylistList(queryClient, context.previousPlaylists);
      onNotify(mutationError(cause), "bad");
    },
  });
  const updateMutation = useMutation({
    mutationFn: (input: PlaylistUpdateInput) => updatePlaylist(input),
    onMutate: async (
      input: PlaylistUpdateInput,
    ): Promise<PlaylistDetailMutationContext> => {
      const detailKey = playlistQueryKey(input.playlistId);
      await Promise.all([
        queryClient.cancelQueries({
          queryKey: PLAYLISTS_QUERY_KEY,
          exact: true,
        }),
        queryClient.cancelQueries({ queryKey: detailKey, exact: true }),
      ]);
      const previousPlaylists =
        queryClient.getQueryData<PlaylistSummary[]>(PLAYLISTS_QUERY_KEY);
      const previousPlaylist =
        queryClient.getQueryData<PlaylistDetail>(detailKey);
      let optimisticPlaylist = previousPlaylist;
      if (optimisticPlaylist && input.name !== undefined) {
        optimisticPlaylist = { ...optimisticPlaylist, name: input.name };
      }
      if (optimisticPlaylist && input.songIndexesToRemove?.length) {
        optimisticPlaylist = removedPlaylistTracks(
          optimisticPlaylist,
          input.songIndexesToRemove,
        );
      }
      if (optimisticPlaylist) {
        queryClient.setQueryData(detailKey, optimisticPlaylist);
        queryClient.setQueryData<PlaylistSummary[]>(
          PLAYLISTS_QUERY_KEY,
          (current) =>
            upsertPlaylistSummary(current, playlistSummary(optimisticPlaylist)),
        );
      } else if (input.name !== undefined) {
        const nextName = input.name;
        queryClient.setQueryData<PlaylistSummary[]>(
          PLAYLISTS_QUERY_KEY,
          (current) =>
            current?.map((item) =>
              item.id === input.playlistId ? { ...item, name: nextName } : item,
            ),
        );
      }
      return { previousPlaylist, previousPlaylists };
    },
    onSuccess: (updated, input) => {
      if (updated) {
        queryClient.setQueryData(playlistQueryKey(updated.id), updated);
        queryClient.setQueryData<PlaylistSummary[]>(
          PLAYLISTS_QUERY_KEY,
          (current) => upsertPlaylistSummary(current, playlistSummary(updated)),
        );
      } else {
        revalidateCommittedPlaylist(queryClient, input.playlistId);
      }
    },
    onError: (cause, input, context) => {
      if (context) {
        restorePlaylistMutation(queryClient, input.playlistId, context);
      }
      onNotify(mutationError(cause), "bad");
    },
  });
  const deleteMutation = useMutation({
    mutationFn: deletePlaylist,
    onMutate: async (playlistId): Promise<PlaylistDetailMutationContext> => {
      const detailKey = playlistQueryKey(playlistId);
      await Promise.all([
        queryClient.cancelQueries({
          queryKey: PLAYLISTS_QUERY_KEY,
          exact: true,
        }),
        queryClient.cancelQueries({ queryKey: detailKey, exact: true }),
      ]);
      const previousPlaylists =
        queryClient.getQueryData<PlaylistSummary[]>(PLAYLISTS_QUERY_KEY);
      const previousPlaylist =
        queryClient.getQueryData<PlaylistDetail>(detailKey);
      queryClient.setQueryData<PlaylistSummary[]>(
        PLAYLISTS_QUERY_KEY,
        (current) => current?.filter((item) => item.id !== playlistId),
      );
      return { previousPlaylist, previousPlaylists };
    },
    onSuccess: (_result, playlistId) => {
      queryClient.removeQueries({
        queryKey: playlistQueryKey(playlistId),
        exact: true,
      });
      onNotify("Playlist deleted", "good");
      if (props.screen !== "detail") return;
      void runPlaylistNavigation(
        () => props.onBack(),
        undefined,
        () => props.onReplaceIndex(),
      );
    },
    onError: (cause, playlistId, context) => {
      if (context) restorePlaylistMutation(queryClient, playlistId, context);
      onNotify(mutationError(cause), "bad");
    },
  });

  if (!connected) {
    return (
      <section className={cn(savedPageClassName, className)}>
        <SavedEmpty
          icon={<ListMusic size={28} />}
          title="Connect Bandcamp to see playlists"
          detail="Playlists are read from your official Bandcamp Subsonic library."
        />
      </section>
    );
  }

  if (props.screen === "detail") {
    return (
      <section className={cn(savedPageClassName, className)}>
        {playlist.isError ? (
          <SavedEmpty
            icon={<ListMusic size={28} />}
            title="This playlist couldn’t load"
            detail={mutationError(playlist.error)}
            action={
              <Button
                onClick={() => void playlist.refetch()}
                disabled={playlist.isFetching}
                size="compact"
              >
                {playlist.isFetching ? (
                  <Spinner aria-hidden="true" className="size-4 text-current" />
                ) : (
                  <RefreshCw size={14} />
                )}
                {playlist.isFetching ? "Trying again…" : "Try again"}
              </Button>
            }
          />
        ) : (
          <PlaylistDetailView
            playlist={playlist.data}
            loading={playlist.isLoading}
            onBack={closePlaylist}
            onPlay={props.onPlayTracks}
            onQueue={props.onQueueTracks}
            currentTrackId={props.currentTrackId}
            playing={props.playing}
            loadingAlbumId={props.loadingAlbumId}
            onTogglePlayback={props.onTogglePlayback}
            onAddToPlaylist={props.onAddToPlaylist}
            onOpenTrackAlbum={props.onOpenTrackAlbum}
            onOpenArtist={props.onOpenArtist}
            onRename={(name) =>
              updateMutation.mutate({ playlistId: props.playlistId, name })
            }
            onRemove={(index) =>
              updateMutation.mutate({
                playlistId: props.playlistId,
                songIndexesToRemove: [index],
              })
            }
            onDelete={() => deleteMutation.mutate(props.playlistId)}
            actionPending={updateMutation.isPending || deleteMutation.isPending}
            pendingRemovalIndex={
              updateMutation.isPending
                ? updateMutation.variables?.songIndexesToRemove?.[0]
                : undefined
            }
            renaming={
              updateMutation.isPending && Boolean(updateMutation.variables?.name)
            }
            deleting={deleteMutation.isPending}
          />
        )}
      </section>
    );
  }

  return (
    <section className={cn(savedPageClassName, className)}>
      <header className="mb-7 flex items-start justify-between gap-6">
        <div>
          <Eyebrow>Synced with Bandcamp</Eyebrow>
          <h1 className="m-0 font-display text-4xl leading-none font-semibold tracking-tighter text-foreground">
            Playlists
          </h1>
          <p className="mt-2 mb-0 text-xs text-muted-foreground">
            Build a sequence here and it follows you to Bandcamp.
          </p>
        </div>
        <Button
          onClick={() => void playlists.refetch()}
          disabled={playlists.isFetching}
          size="compact"
          variant="artwork"
        >
          {playlists.isFetching ? (
            <Spinner aria-hidden="true" className="size-4 text-current" />
          ) : (
            <RefreshCw size={15} />
          )}
          {playlists.isFetching ? "Refreshing…" : "Refresh"}
        </Button>
      </header>
      {playlists.isLoading ? (
        <SavedEmpty
          icon={<Spinner aria-hidden="true" className="size-7 text-current" />}
          title="Loading playlists"
          detail="Pulling your latest Bandcamp mixes…"
        />
      ) : playlists.isError ? (
        <SavedEmpty
          icon={<ListMusic size={28} />}
          title="Playlists couldn’t load"
          detail={mutationError(playlists.error)}
          action={
            <Button
              onClick={() => void playlists.refetch()}
              disabled={playlists.isFetching}
              size="compact"
            >
              {playlists.isFetching ? (
                <Spinner aria-hidden="true" className="size-4 text-current" />
              ) : (
                <RefreshCw size={14} />
              )}
              {playlists.isFetching ? "Trying again…" : "Try again"}
            </Button>
          }
        />
      ) : (
        <PlaylistList
          playlists={playlists.data ?? []}
          onOpen={(item, trigger) => {
            // SAFETY: playlist ids are validated at parseNativePlaylistSummary.
            const playlistId = item.id as PlaylistId;
            const hasCachedDetail =
              queryClient.getQueryData<PlaylistDetail>(
                playlistQueryKey(playlistId),
              ) !== undefined;
            const sourceIdentity = trigger.querySelector<HTMLElement>(
              "[data-playlist-identity]",
            );
            const hasSharedIdentity =
              hasCachedDetail &&
              sourceIdentity?.dataset.playlistIdentity === playlistId;
            setOpeningPlaylistId(playlistId);
            void runPlaylistNavigation(
              () =>
                props.onOpenPlaylist({
                  playlistId,
                  sharedIdentityAvailable: hasSharedIdentity,
                  sourceTrigger: trigger,
                }),
              () => {
                setOpeningPlaylistId((current) =>
                  current === playlistId ? undefined : current,
                );
              },
            );
          }}
          onCreate={(name) => createMutation.mutate(name)}
          creating={createMutation.isPending}
          openingPlaylistId={openingPlaylistId}
        />
      )}
    </section>
  );
}
