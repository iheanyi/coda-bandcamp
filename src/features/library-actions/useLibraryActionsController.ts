import { useCallback, useMemo, useRef, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";

import type { ToastNotifier } from "@/components/ui/toastManager";
import type { LibrarySessionCommands } from "@/features/library-session";
import type { DetailNavigationController } from "@/features/navigation/useDetailNavigation";
import { tracksForArtistGroupAlbum, type ArtistGroup } from "@/libraryBrowse";
import {
  cachedAlbumTracks,
  libraryQueryKey,
  revalidateAlbumQueryData,
} from "@/libraryQueries";
import { countLabel } from "@/countLabel";
import {
  pickRandomItem,
  weightedRandomOrder,
  yieldToMacrotask,
} from "@/random";
import { parseAlbumIdParam } from "@/routing/routeContracts";
import { resolveSurprise } from "@/surpriseMe";
import type { Album, Track } from "@/types";

const ALBUM_BATCH_CONCURRENCY = 6;
const RANDOM_PICK_YIELD_INTERVAL = 16;

type ArtistAction = "play" | "queue";

export type QueueSearchProgress = Readonly<{
  done: number;
  total: number;
}>;

type PlaybackActions = Readonly<{
  cancelShuffle: () => void;
  playTrack: (track: Track) => void;
  playTracks: (tracks: Track[]) => void;
  queueTracks: (tracks: Track[]) => void;
  startShuffle: (
    albums: readonly Album[],
    scopeName: string,
    artistScope?: ArtistGroup,
  ) => void;
}>;

type UpdateAlbums = (update: (albums: Album[]) => Album[]) => void;

export type LibraryActionsControllerOptions = Readonly<{
  albums: readonly Album[];
  artworkRefreshing: boolean;
  connected: boolean;
  detailNavigation: Pick<DetailNavigationController, "open">;
  notify: ToastNotifier;
  playback: PlaybackActions;
  queryClient: QueryClient;
  selectedAlbumId?: string;
  session: LibrarySessionCommands;
  updateAlbums: UpdateAlbums;
}>;

export type LibraryActionsState = Readonly<{
  artistAction?: ArtistAction;
  loadingAlbumId?: string;
  queueSearchProgress?: QueueSearchProgress;
  randomPickLoading: boolean;
  selectedAlbum?: Album;
}>;

export type LibraryActionsCommands = Readonly<{
  acceptConnectedLibrary: (albums: readonly Album[]) => void;
  clearSelectedAlbum: () => void;
  disconnect: () => Promise<void>;
  openAlbum: (album: Album, sourceTrigger?: HTMLElement) => Promise<void>;
  playAlbum: (album: Album) => Promise<void>;
  playArtist: (group: ArtistGroup) => void;
  playRandomTrack: (
    albums: readonly Album[],
    scopeName: string,
    artistScope?: ArtistGroup,
  ) => Promise<void>;
  playSurprise: (
    albums: readonly Album[],
    scopeName: string,
    artistScope?: ArtistGroup,
  ) => Promise<void>;
  queueAlbum: (album: Album) => Promise<boolean>;
  queueAlbums: (albums: readonly Album[]) => Promise<void>;
  queueArtist: (group: ArtistGroup) => void;
  refreshArtwork: () => Promise<void>;
  resetTransientState: () => void;
  shuffleArtist: (group: ArtistGroup) => void;
}>;

export type LibraryActionsController = Readonly<{
  commands: LibraryActionsCommands;
  state: LibraryActionsState;
}>;

function albumWithTracks(album: Album, tracks: readonly Track[]): Album {
  return {
    ...album,
    coverArt:
      album.coverArt ?? tracks.find((track) => track.coverArt)?.coverArt,
    tracks: [...tracks],
  };
}

function albumWithRecoveredCover(
  album: Album,
  tracks: readonly Track[],
): Album {
  if (album.coverArt) return album;
  const coverArt = tracks.find((track) => track.coverArt)?.coverArt;
  return coverArt ? { ...album, coverArt } : album;
}

/**
 * Owns generation-safe library action workflows and their bounded transient
 * progress. TanStack Query and LibrarySession remain the only remote-data
 * owners; this module coordinates them with playback without duplicating data.
 */
export function useLibraryActionsController({
  albums,
  artworkRefreshing,
  connected,
  detailNavigation,
  notify,
  playback,
  queryClient,
  selectedAlbumId,
  session,
  updateAlbums,
}: LibraryActionsControllerOptions): LibraryActionsController {
  const {
    cancelShuffle,
    playTrack: activateTrack,
    playTracks,
    queueTracks,
    startShuffle,
  } = playback;
  const [selectedAlbumSnapshot, setSelectedAlbumSnapshot] = useState<Album>();
  const [loadingAlbumId, setLoadingAlbumId] = useState<string>();
  const [artistAction, setArtistAction] = useState<ArtistAction>();
  const [queueSearchProgress, setQueueSearchProgress] =
    useState<QueueSearchProgress>();
  const [randomPickLoading, setRandomPickLoading] = useState(false);
  const randomPickActiveRef = useRef(false);

  const selectedAlbum = selectedAlbumId
    ? selectedAlbumSnapshot?.id === selectedAlbumId
      ? selectedAlbumSnapshot
      : albums.find((album) => album.id === selectedAlbumId)
    : undefined;

  const ensureTracks = useCallback(
    async (
      album: Album,
      sessionGeneration = session.generation.current(),
    ): Promise<Album | undefined> => {
      if (!session.generation.isCurrent(sessionGeneration)) return undefined;
      try {
        const hydrated = await session.ensureAlbum(album);
        if (!hydrated || !session.generation.isCurrent(sessionGeneration)) {
          return undefined;
        }
        setSelectedAlbumSnapshot((item) =>
          item?.id === album.id ? hydrated : item,
        );
        return hydrated;
      } catch (cause) {
        if (!session.generation.isCurrent(sessionGeneration)) return undefined;
        throw cause;
      }
    },
    [session],
  );

  const openAlbum = useCallback(
    async (album: Album, sourceTrigger?: HTMLElement) => {
      const sessionGeneration = session.generation.current();
      const hasLocalTracklist = Boolean(album.tracks?.length);
      const cachedTracks = cachedAlbumTracks(queryClient, album);
      const coldLoad = cachedTracks === undefined;
      let albumForDetail = coldLoad
        ? album
        : albumWithTracks(album, cachedTracks);
      let hydrationPending = coldLoad;

      void detailNavigation
        .open({
          kind: "album",
          albumId: parseAlbumIdParam(album.id),
          coldLoad,
          sourceTrigger,
          beforeCommit: () => {
            if (!session.generation.isCurrent(sessionGeneration)) return;
            setLoadingAlbumId(hydrationPending ? album.id : undefined);
            setSelectedAlbumSnapshot(albumForDetail);
          },
        })
        .catch((cause) => {
          if (!session.generation.isCurrent(sessionGeneration)) return;
          notify(String(cause), "bad");
        });

      try {
        const ready = await ensureTracks(album, sessionGeneration);
        if (!ready || !session.generation.isCurrent(sessionGeneration)) return;
        albumForDetail = ready;
        setSelectedAlbumSnapshot((item) =>
          item?.id === album.id ? albumForDetail : item,
        );
        if (hasLocalTracklist) {
          void revalidateAlbumQueryData(queryClient, album)
            .then((tracks) => {
              if (!session.generation.isCurrent(sessionGeneration)) return;
              if (!tracks.length && albumForDetail.tracks?.length) return;
              const refreshed = albumWithTracks(albumForDetail, tracks);
              updateAlbums((items) =>
                items.map((item) =>
                  item.id === album.id
                    ? albumWithRecoveredCover(item, tracks)
                    : item,
                ),
              );
              setSelectedAlbumSnapshot((item) =>
                item?.id === album.id ? refreshed : item,
              );
            })
            .catch(() => {
              // Retain the usable local tracklist after background failure.
            });
        }
      } catch (cause) {
        if (session.generation.isCurrent(sessionGeneration)) {
          notify(String(cause), "bad");
        }
      } finally {
        hydrationPending = false;
        if (coldLoad) {
          setLoadingAlbumId((current) =>
            current === album.id ? undefined : current,
          );
        }
      }
    },
    [
      detailNavigation,
      ensureTracks,
      notify,
      queryClient,
      session,
      updateAlbums,
    ],
  );

  const playAlbum = useCallback(
    async (album: Album) => {
      cancelShuffle();
      const generation = session.generation.current();
      try {
        const ready = await ensureTracks(album, generation);
        if (
          !ready?.tracks?.length ||
          !session.generation.isCurrent(generation)
        ) {
          return;
        }
        playTracks(ready.tracks);
      } catch (cause) {
        if (session.generation.isCurrent(generation)) {
          notify(String(cause), "bad");
        }
      }
    },
    [cancelShuffle, ensureTracks, notify, playTracks, session],
  );

  const queueAlbum = useCallback(
    async (album: Album): Promise<boolean> => {
      cancelShuffle();
      const generation = session.generation.current();
      try {
        const ready = await ensureTracks(album, generation);
        if (
          !ready?.tracks?.length ||
          !session.generation.isCurrent(generation)
        ) {
          return false;
        }
        queueTracks(ready.tracks);
        notify(`${album.title} added to queue`, "good");
        return true;
      } catch (cause) {
        if (session.generation.isCurrent(generation)) {
          notify(String(cause), "bad");
        }
        return false;
      }
    },
    [cancelShuffle, ensureTracks, notify, queueTracks, session],
  );

  const loadArtistTracks = useCallback(
    async (group: ArtistGroup, action: "play" | "queue") => {
      if (artistAction || !connected) return;
      cancelShuffle();
      const generation = session.generation.current();
      setArtistAction(action);
      try {
        const result = await session.ensureAlbums(group.albums, {
          concurrency: ALBUM_BATCH_CONCURRENCY,
        });
        if (result.stale || !session.generation.isCurrent(generation)) return;
        const tracks = result.albums.flatMap((album) =>
          album
            ? tracksForArtistGroupAlbum(group, album.id, album.tracks ?? [])
            : [],
        );
        if (!tracks.length) {
          notify(`No playable tracks were returned for ${group.name}.`, "bad");
          return;
        }
        if (action === "play") {
          playTracks(tracks);
          notify(`Playing ${group.name}`, "good");
        } else {
          queueTracks(tracks);
          notify(
            `${countLabel(tracks.length, `${group.name} track`)} added to queue`,
            "good",
          );
        }
      } finally {
        if (session.generation.isCurrent(generation)) {
          setArtistAction(undefined);
        }
      }
    },
    [
      artistAction,
      cancelShuffle,
      connected,
      notify,
      playTracks,
      queueTracks,
      session,
    ],
  );

  const queueAlbums = useCallback(
    async (scopeAlbums: readonly Album[]) => {
      if (!connected || queueSearchProgress || !scopeAlbums.length) return;
      cancelShuffle();
      const generation = session.generation.current();
      const targets = [...scopeAlbums];
      setQueueSearchProgress({ done: 0, total: targets.length });
      try {
        const result = await session.ensureAlbums(targets, {
          concurrency: ALBUM_BATCH_CONCURRENCY,
          onProgress: ({ completed, total }) => {
            if (session.generation.isCurrent(generation)) {
              setQueueSearchProgress({ done: completed, total });
            }
          },
        });
        if (result.stale || !session.generation.isCurrent(generation)) return;
        const readyAlbums = result.albums.filter(
          (album): album is Album => album !== undefined,
        );
        const tracks = readyAlbums.flatMap((album) => album.tracks ?? []);
        queueTracks(tracks);
        notify(
          tracks.length
            ? `${countLabel(tracks.length, "track")} from ${countLabel(readyAlbums.length, "search result")} added`
            : "No playable tracks were returned for those results.",
          tracks.length ? "good" : "bad",
        );
      } finally {
        if (session.generation.isCurrent(generation)) {
          setQueueSearchProgress(undefined);
        }
      }
    },
    [
      cancelShuffle,
      connected,
      notify,
      queueSearchProgress,
      queueTracks,
      session,
    ],
  );

  const playRandomTrack = useCallback(
    async (
      scopeAlbums: readonly Album[],
      scopeName: string,
      artistScope?: ArtistGroup,
    ) => {
      if (randomPickActiveRef.current || !connected || !scopeAlbums.length) {
        return;
      }
      cancelShuffle();
      const generation = session.generation.current();
      randomPickActiveRef.current = true;
      setRandomPickLoading(true);
      const candidates = weightedRandomOrder(scopeAlbums, (album) =>
        Math.max(1, album.songCount),
      );
      let misses = 0;

      try {
        for (const album of candidates) {
          if (!session.generation.isCurrent(generation)) return;
          try {
            const ready = await ensureTracks(album, generation);
            if (!ready || !session.generation.isCurrent(generation)) return;
            const tracks = artistScope
              ? tracksForArtistGroupAlbum(
                  artistScope,
                  album.id,
                  ready.tracks ?? [],
                )
              : (ready.tracks ?? []);
            const track = pickRandomItem(tracks);
            if (!track) {
              misses += 1;
              if (misses % RANDOM_PICK_YIELD_INTERVAL === 0) {
                await yieldToMacrotask();
              }
              continue;
            }
            activateTrack(track);
            notify(`Playing ${track.title} by ${track.artist}.`, "good");
            return;
          } catch {
            if (!session.generation.isCurrent(generation)) return;
            misses += 1;
            if (misses % RANDOM_PICK_YIELD_INTERVAL === 0) {
              await yieldToMacrotask();
            }
          }
        }
        if (session.generation.isCurrent(generation)) {
          notify(`No playable tracks were found in ${scopeName}.`, "bad");
        }
      } finally {
        if (session.generation.isCurrent(generation)) {
          randomPickActiveRef.current = false;
          setRandomPickLoading(false);
        }
      }
    },
    [activateTrack, cancelShuffle, connected, ensureTracks, notify, session],
  );

  const playSurprise = useCallback(
    async (
      scopeAlbums: readonly Album[],
      scopeName: string,
      artistScope?: ArtistGroup,
    ) => {
      if (randomPickActiveRef.current || !connected || !scopeAlbums.length) {
        return;
      }
      cancelShuffle();
      const generation = session.generation.current();
      randomPickActiveRef.current = true;
      setRandomPickLoading(true);
      try {
        const result = await resolveSurprise(scopeAlbums, {
          loadTracks: async (album) =>
            (await ensureTracks(album, generation))?.tracks,
          selectTracks: artistScope
            ? (album, tracks) =>
                tracksForArtistGroupAlbum(artistScope, album.id, [...tracks])
            : undefined,
          isActive: () => session.generation.isCurrent(generation),
        });
        if (!session.generation.isCurrent(generation)) return;
        if (!result) {
          notify(`No playable music was found in ${scopeName}.`, "bad");
          return;
        }
        playTracks(result.queue);
        notify(
          result.kind === "album"
            ? `Playing ${result.album.title} by ${result.album.artist}.`
            : `Playing ${result.queue[0].title} by ${result.queue[0].artist}.`,
          "good",
        );
      } finally {
        if (session.generation.isCurrent(generation)) {
          randomPickActiveRef.current = false;
          setRandomPickLoading(false);
        }
      }
    },
    [cancelShuffle, connected, ensureTracks, notify, playTracks, session],
  );

  const clearSelectedAlbum = useCallback(() => {
    setSelectedAlbumSnapshot(undefined);
  }, []);

  const resetTransientState = useCallback(() => {
    randomPickActiveRef.current = false;
    setLoadingAlbumId(undefined);
    setArtistAction(undefined);
    setQueueSearchProgress(undefined);
    setRandomPickLoading(false);
  }, []);

  const refreshArtwork = useCallback(async () => {
    if (!connected || artworkRefreshing) return;
    await session.refreshArtwork();
    setSelectedAlbumSnapshot((album) => {
      if (!album) return album;
      const refreshed = queryClient
        .getQueryData<Album[]>(libraryQueryKey)
        ?.find((candidate) => candidate.id === album.id);
      return refreshed?.coverArt
        ? { ...album, coverArt: refreshed.coverArt }
        : album;
    });
  }, [artworkRefreshing, connected, queryClient, session]);

  const acceptConnectedLibrary = useCallback(
    (library: readonly Album[]) => {
      cancelShuffle();
      resetTransientState();
      session.acceptConnectedLibrary(library);
    },
    [cancelShuffle, resetTransientState, session],
  );

  const disconnect = useCallback(async () => {
    cancelShuffle();
    await session.disconnect();
    resetTransientState();
    setSelectedAlbumSnapshot(undefined);
  }, [cancelShuffle, resetTransientState, session]);

  const commands = useMemo<LibraryActionsCommands>(
    () => ({
      acceptConnectedLibrary,
      clearSelectedAlbum,
      disconnect,
      openAlbum,
      playAlbum,
      playArtist: (group) => void loadArtistTracks(group, "play"),
      playRandomTrack,
      playSurprise,
      queueAlbum,
      queueAlbums,
      queueArtist: (group) => void loadArtistTracks(group, "queue"),
      refreshArtwork,
      resetTransientState,
      shuffleArtist: (group) => startShuffle(group.albums, group.name, group),
    }),
    [
      acceptConnectedLibrary,
      clearSelectedAlbum,
      disconnect,
      loadArtistTracks,
      openAlbum,
      playAlbum,
      playRandomTrack,
      playSurprise,
      queueAlbum,
      queueAlbums,
      refreshArtwork,
      resetTransientState,
      startShuffle,
    ],
  );

  return useMemo(
    () => ({
      commands,
      state: {
        artistAction,
        loadingAlbumId,
        queueSearchProgress,
        randomPickLoading,
        selectedAlbum,
      },
    }),
    [
      artistAction,
      commands,
      loadingAlbumId,
      queueSearchProgress,
      randomPickLoading,
      selectedAlbum,
    ],
  );
}
