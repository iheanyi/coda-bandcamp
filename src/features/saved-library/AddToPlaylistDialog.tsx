import { ListMusic, Plus, Search, X } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useMemo, useRef, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { ToastNotifier } from "@/components/ui/toastManager";
import { countLabel } from "@/countLabel";
import { updatePlaylist } from "@/lib";
import {
  PLAYLISTS_QUERY_KEY,
  playlistQueryKey,
  playlistsQueryOptions,
} from "@/queries/savedLibraryQueries";
import type { PlaylistDetail, PlaylistSummary, Track } from "@/types";
import { VirtualizedSavedTrackList } from "@/VirtualizedSavedTrackList";

import {
  addedPlaylistTracks,
  type PlaylistDetailMutationContext,
  playlistSummary,
  restorePlaylistMutation,
  revalidateCommittedPlaylist,
  upsertPlaylistSummary,
} from "./playlistCache";
import { formatErrorMessage } from "@/formatError";
import { Eyebrow } from "./SavedLibraryPresentation";
import { useCreatePlaylistMutation } from "./useCreatePlaylistMutation";

const playlistSummaryKey = (playlist: PlaylistSummary) => playlist.id;
const parentScrollElement = (root: HTMLElement) => root.parentElement;

export function AddToPlaylistDialog({
  open = true,
  tracks,
  onClose,
  onExited,
  onNotify,
}: {
  open?: boolean;
  tracks: Track[];
  onClose: () => void;
  onExited?: () => void;
  onNotify: ToastNotifier;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [playlistSearch, setPlaylistSearch] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const playlistScrollRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef(
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const playlists = useQuery(playlistsQueryOptions());
  const matchingPlaylists = useMemo(() => {
    const query = playlistSearch.trim().toLocaleLowerCase();
    return query
      ? playlists.data?.filter((playlist) =>
          playlist.name.toLocaleLowerCase().includes(query),
        )
      : playlists.data;
  }, [playlistSearch, playlists.data]);
  const changePlaylistSearch = (query: string) => {
    setPlaylistSearch(query);
    if (playlistScrollRef.current) playlistScrollRef.current.scrollTop = 0;
  };
  const songIds = useMemo(
    () => Array.from(new Set(tracks.map((track) => track.id))),
    [tracks],
  );
  const addMutation = useMutation({
    mutationFn: async (playlist: PlaylistSummary) =>
      updatePlaylist({ playlistId: playlist.id, songIdsToAdd: songIds }),
    onMutate: async (target): Promise<PlaylistDetailMutationContext> => {
      const detailKey = playlistQueryKey(target.id);
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
      const optimisticDetail = previousPlaylist
        ? addedPlaylistTracks(previousPlaylist, tracks)
        : undefined;
      const uniqueTrackCount = new Set(tracks.map((track) => track.id)).size;
      const optimisticSummary = optimisticDetail
        ? playlistSummary(optimisticDetail)
        : {
            ...target,
            duration:
              target.duration +
              tracks.reduce((total, track) => total + track.duration, 0),
            songCount: target.songCount + uniqueTrackCount,
          };
      queryClient.setQueryData<PlaylistSummary[]>(
        PLAYLISTS_QUERY_KEY,
        (current) => upsertPlaylistSummary(current, optimisticSummary),
      );
      if (optimisticDetail) {
        queryClient.setQueryData(detailKey, optimisticDetail);
      }
      return { previousPlaylist, previousPlaylists };
    },
    onSuccess: (updated, target) => {
      if (updated) {
        queryClient.setQueryData(playlistQueryKey(updated.id), updated);
        queryClient.setQueryData<PlaylistSummary[]>(
          PLAYLISTS_QUERY_KEY,
          (current) => upsertPlaylistSummary(current, playlistSummary(updated)),
        );
      } else {
        revalidateCommittedPlaylist(queryClient, target.id);
      }
      onNotify(
        `${countLabel(tracks.length, "track")} added to ${updated?.name ?? target.name}`,
        "good",
      );
      onClose();
    },
    onError: (cause, target, context) => {
      if (context) restorePlaylistMutation(queryClient, target.id, context);
      onNotify(formatErrorMessage(cause), "bad");
    },
  });
  const createMutation = useCreatePlaylistMutation({
    onCommitted: (created) => {
      onNotify(
        `${created.name} created with ${countLabel(tracks.length, "track")}`,
        "good",
      );
      onClose();
    },
    onNotify,
    songIds,
    tracks,
  });
  const pending = addMutation.isPending || createMutation.isPending;
  const submitCreate = (event: FormEvent) => {
    event.preventDefault();
    const nextName = name.trim();
    if (nextName) createMutation.mutate(nextName);
  };

  return (
    <Dialog
      open={open}
      onExitComplete={onExited}
      onOpenChange={(open, details) => {
        if (open) return;
        if (pending) {
          details.cancel();
          return;
        }
        onClose();
      }}
    >
      <DialogContent
        className="max-h-[min(--spacing(155),calc(100vh-(--spacing(38))))] max-w-120 gap-0 overflow-hidden p-0"
        aria-busy={pending || playlists.isFetching}
        finalFocus={restoreFocusRef}
        initialFocus={nameInputRef}
        showCloseButton={false}
      >
        <DialogHeader className="flex-row items-start justify-between gap-4 px-6 pt-6 pb-4">
          <div>
            <Eyebrow>Bandcamp playlists</Eyebrow>
            <DialogTitle className="font-display text-2xl leading-none font-semibold text-[#efede7]">
              Add to playlist
            </DialogTitle>
            <DialogDescription className="mt-2 text-xs text-[#7c807b]">
              {countLabel(tracks.length, "track")} selected
            </DialogDescription>
          </div>
          <DialogClose
            aria-label="Close add to playlist"
            disabled={pending}
            render={<Button size="icon" variant="ghost" />}
          >
            <X size={18} />
          </DialogClose>
        </DialogHeader>
        <form
          className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-b border-border px-6 pb-5"
          onSubmit={submitCreate}
        >
          <Input
            ref={nameInputRef}
            value={name}
            maxLength={256}
            onChange={(event) => setName(event.target.value)}
            placeholder="Create a new playlist"
            aria-label="New playlist name"
          />
          <Button type="submit" disabled={!name.trim() || pending}>
            {createMutation.isPending ? (
              <Spinner aria-hidden="true" className="size-4 text-current" />
            ) : (
              <Plus size={15} />
            )}
            {createMutation.isPending ? "Creating…" : "Create"}
          </Button>
        </form>
        {!!playlists.data?.length && (
          <div className="relative mx-6 mt-3 mb-1">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              ref={searchInputRef}
              className="pr-10 pl-9"
              value={playlistSearch}
              onChange={(event) => changePlaylistSearch(event.target.value)}
              placeholder="Find a playlist"
              aria-label="Find a playlist"
              disabled={pending}
            />
            {playlistSearch && (
              <Button
                className="absolute top-1/2 right-1 -translate-y-1/2"
                size="icon-sm"
                variant="ghost"
                aria-label="Clear playlist search"
                disabled={pending}
                onClick={() => {
                  changePlaylistSearch("");
                  searchInputRef.current?.focus();
                }}
              >
                <X size={14} />
              </Button>
            )}
            <span className="sr-only" role="status">
              {playlistSearch.trim()
                ? `${countLabel(matchingPlaylists?.length ?? 0, "playlist")} found`
                : ""}
            </span>
          </div>
        )}
        <div
          ref={playlistScrollRef}
          className="flex max-h-84 scrollbar-thin [scrollbar-color:#3e4142_transparent] flex-col overflow-y-auto p-2"
          data-add-to-playlist-scroll
        >
          {playlists.isLoading ? (
            <span className="flex min-h-28 items-center justify-center gap-2 text-xs text-[#858984]">
              <Spinner aria-hidden="true" className="size-4" />
              Loading playlists…
            </span>
          ) : playlists.isError ? (
            <Alert className="my-6" variant="danger">
              <AlertDescription>Couldn’t load playlists.</AlertDescription>
              <Button
                className="mt-2 h-auto p-0 text-xs text-current"
                onClick={() => void playlists.refetch()}
                disabled={playlists.isFetching}
                variant="text"
              >
                {playlists.isFetching ? "Trying again…" : "Try again"}
              </Button>
            </Alert>
          ) : matchingPlaylists?.length ? (
            <VirtualizedSavedTrackList
              aria-label="Available playlists"
              className="shrink-0"
              getItemKey={playlistSummaryKey}
              getScrollElement={parentScrollElement}
              items={matchingPlaylists}
              rowHeight={56}
              renderItem={(playlist, _context, rowProps) => (
                <div {...rowProps}>
                  <Button
                    className="grid h-14 w-full grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md border-0 bg-transparent px-2.5 py-1.5 text-left font-normal hover:bg-white/4.5"
                    disabled={pending}
                    onClick={() => addMutation.mutate(playlist)}
                  >
                    <span className="grid size-9 place-items-center rounded-md bg-muted text-[#a16c5f]">
                      <ListMusic size={17} />
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <strong className="truncate text-xs text-[#d6d5cf]">
                        {playlist.name}
                      </strong>
                      <small className="mt-1 text-xs text-[#757974]">
                        {countLabel(playlist.songCount, "track")}
                      </small>
                    </span>
                    {addMutation.isPending &&
                    addMutation.variables.id === playlist.id ? (
                      <Spinner
                        aria-hidden="true"
                        className="size-4 text-current"
                      />
                    ) : (
                      <Plus size={16} />
                    )}
                  </Button>
                </div>
              )}
            />
          ) : (
            <span className="flex min-h-28 items-center justify-center gap-2 text-xs text-[#858984]">
              {playlists.data?.length
                ? "No matching playlists. Try a different name."
                : "No playlists yet. Create one above."}
            </span>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
