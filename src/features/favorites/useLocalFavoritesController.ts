import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ToastNotifier } from "@/components/ui/toastManager";
import { formatErrorMessage } from "@/formatError";
import {
  fetchFavorites,
  reconcileFavoriteTracks,
  setFavorite,
} from "@/lib";
import {
  emptyLocalFavorites,
  localTrackStarBoundMessage,
  localTrackStarIndexAndRadio,
  localTrackStarIndexCanAccept,
  reconcileLocalTrackStarIndex,
  updateLocalFavorites,
  updateLocalRadioFavorite,
} from "@/localFavorites";
import {
  readLocalFavoritesAsync,
  writeLocalFavoritesAsync,
} from "@/localFavoritesStore";
import type {
  Album,
  FavoriteCollection,
  FavoriteInput,
  FavoriteMutationResult,
  FavoriteTrackLocator,
  FavoriteTrackReconciliation,
  LocalFavoriteCollection,
  RadioShowSummary,
  Track,
} from "@/types";

export const FAVORITES_QUERY_KEY = ["bandcamp", "favorites"] as const;

export type LocalFavoritesRepository = Readonly<{
  read: () => Promise<LocalFavoriteCollection>;
  write: (
    favorites: LocalFavoriteCollection,
  ) => Promise<LocalFavoriteCollection>;
}>;

const defaultLocalFavoritesRepository: LocalFavoritesRepository = {
  read: readLocalFavoritesAsync,
  write: writeLocalFavoritesAsync,
};

export type MusicFavoritesRepository = Readonly<{
  read: () => Promise<FavoriteCollection>;
  write: (input: FavoriteInput) => Promise<FavoriteMutationResult>;
  reconcile?: (
    tracks: FavoriteTrackLocator[],
  ) => Promise<FavoriteTrackReconciliation>;
}>;

const defaultMusicFavoritesRepository: MusicFavoritesRepository = {
  read: fetchFavorites,
  write: setFavorite,
  reconcile: reconcileFavoriteTracks,
};

type FavoriteKind = "album" | "song";

export type FavoritesController = Readonly<{
  collection: LocalFavoriteCollection;
  ready: boolean;
  loadError?: string;
  favoriteAlbumIds: ReadonlySet<string>;
  favoriteRadioShowIds: ReadonlySet<number>;
  favoriteTrackIds: ReadonlySet<string>;
  ensureReady: () => boolean;
  refresh: () => void;
  toggleFavorite: (
    id: string,
    kind: FavoriteKind,
    favorite?: boolean,
  ) => void;
  toggleRadioFavorite: (
    show: RadioShowSummary,
    favorite?: boolean,
  ) => void;
}>;

type UseLocalFavoritesControllerOptions = Readonly<{
  albums: readonly Album[];
  connected: boolean;
  musicRepository?: MusicFavoritesRepository;
  notify: ToastNotifier;
  queue: readonly Track[];
  repository?: LocalFavoritesRepository;
  selectedAlbum?: Album;
}>;

function emptyMusicFavorites(): FavoriteCollection {
  return { albumIds: [], songIds: [], albums: [], tracks: [] };
}

function withLocalTrackIndexAndRadio(
  music: FavoriteCollection,
  local: LocalFavoriteCollection,
): LocalFavoriteCollection {
  const remoteTrackIds = new Set(music.songIds);
  const remoteTracks = new Map(music.tracks.map((track) => [track.id, track]));
  return {
    albumIds: music.albumIds,
    albums: music.albums,
    songIds: [
      ...music.songIds,
      ...local.songIds.filter((id) => !remoteTrackIds.has(id)),
    ],
    tracks: [
      ...music.tracks,
      ...local.tracks.filter((track) => !remoteTracks.has(track.id)),
    ],
    radioShowIds: local.radioShowIds,
    radioShows: local.radioShows,
  };
}

function withLibraryAlbumMetadata(
  music: FavoriteCollection,
  albums: readonly Album[],
): FavoriteCollection {
  if (!music.albums.length || !albums.length) return music;
  const libraryAlbums = new Map(albums.map((album) => [album.id, album]));
  return {
    ...music,
    albums: music.albums.map((favorite) => {
      const libraryAlbum = libraryAlbums.get(favorite.id);
      if (!libraryAlbum) return favorite;
      const album = {
        ...favorite,
        ...libraryAlbum,
      };
      const starredAt = favorite.starredAt ?? libraryAlbum.starredAt;
      if (starredAt !== undefined) album.starredAt = starredAt;
      return album;
    }),
  };
}

function currentTrackMutationRevision(
  revisions: ReadonlyMap<string, number>,
  trackId: string,
): number {
  return revisions.get(trackId) ?? 0;
}

function bumpTrackMutationRevision(
  revisions: Map<string, number>,
  trackId: string,
): number {
  const nextRevision = currentTrackMutationRevision(revisions, trackId) + 1;
  revisions.set(trackId, nextRevision);
  return nextRevision;
}

function trackMutationRevisionIsCurrent(
  revisions: ReadonlyMap<string, number>,
  capturedRevisions: ReadonlyMap<string, number>,
  trackId: string,
): boolean {
  return currentTrackMutationRevision(revisions, trackId) ===
    currentTrackMutationRevision(capturedRevisions, trackId);
}

function trackStarReconciliationForCurrentRevisions(
  result: FavoriteTrackReconciliation,
  revisions: ReadonlyMap<string, number>,
  capturedRevisions: ReadonlyMap<string, number>,
): FavoriteTrackReconciliation {
  let stale = false;
  for (const track of result.tracks) {
    if (trackMutationRevisionIsCurrent(revisions, capturedRevisions, track.id)) {
      continue;
    }
    stale = true;
    break;
  }
  if (!stale) {
    for (const trackId of result.unstarredIds) {
      if (trackMutationRevisionIsCurrent(revisions, capturedRevisions, trackId)) {
        continue;
      }
      stale = true;
      break;
    }
  }
  if (!stale) return result;

  const tracks: Track[] = [];
  for (const track of result.tracks) {
    if (trackMutationRevisionIsCurrent(revisions, capturedRevisions, track.id)) {
      tracks.push(track);
    }
  }
  const unstarredIds: string[] = [];
  for (const trackId of result.unstarredIds) {
    if (trackMutationRevisionIsCurrent(revisions, capturedRevisions, trackId)) {
      unstarredIds.push(trackId);
    }
  }
  return {
    tracks,
    unstarredIds,
    unavailableTrackCount: result.unavailableTrackCount,
  };
}

function updateMusicFavorites(
  current: FavoriteCollection,
  input: FavoriteInput,
  candidate?: Album | Track,
): FavoriteCollection {
  const updated = updateLocalFavorites(
    { ...current, radioShowIds: [], radioShows: [] },
    input,
    candidate,
  );
  return {
    albumIds: updated.albumIds,
    songIds: updated.songIds,
    albums: updated.albums,
    tracks: updated.tracks,
  };
}

export function useLocalFavoritesController({
  albums,
  connected,
  musicRepository = defaultMusicFavoritesRepository,
  notify,
  queue,
  repository = defaultLocalFavoritesRepository,
  selectedAlbum,
}: UseLocalFavoritesControllerOptions): FavoritesController {
  const queryClient = useQueryClient();
  const musicQuery = useQuery({
    queryKey: FAVORITES_QUERY_KEY,
    queryFn: musicRepository.read,
    enabled: connected,
  });
  const [localCollection, setLocalCollection] = useState<LocalFavoriteCollection>(
    emptyLocalFavorites,
  );
  const [localReady, setLocalReady] = useState(false);
  const [localLoadError, setLocalLoadError] = useState<string>();
  const localGenerationRef = useRef(0);
  const connectionEpochRef = useRef(0);
  const persistedLocalCollectionRef = useRef<LocalFavoriteCollection>(
    emptyLocalFavorites(),
  );
  const committedLocalCollectionRef = useRef<LocalFavoriteCollection>(
    emptyLocalFavorites(),
  );
  const mergedEnumeratedTrackStarsRef = useRef("");
  const reconciledHydratedTrackStarsRef = useRef({ epoch: 0, signature: "" });
  const trackMutationRevisionRef = useRef(new Map<string, number>());
  const previousConnectedRef = useRef(connected);

  const refreshLocal = useCallback((): Promise<LocalFavoriteCollection | undefined> => {
    const generation = localGenerationRef.current + 1;
    localGenerationRef.current = generation;
    const epoch = connectionEpochRef.current;
    setLocalReady(false);
    setLocalLoadError(undefined);

    return repository.read().then(
      (favorites) => {
        if (
          localGenerationRef.current !== generation ||
          connectionEpochRef.current !== epoch
        ) {
          return undefined;
        }
        const localFavorites = localTrackStarIndexAndRadio(favorites);
        persistedLocalCollectionRef.current = localFavorites;
        committedLocalCollectionRef.current = localFavorites;
        setLocalCollection(localFavorites);
        setLocalReady(true);
        return localFavorites;
      },
      (cause) => {
        if (
          localGenerationRef.current !== generation ||
          connectionEpochRef.current !== epoch
        ) {
          return undefined;
        }
        const message = formatErrorMessage(cause);
        committedLocalCollectionRef.current = persistedLocalCollectionRef.current;
        setLocalCollection(persistedLocalCollectionRef.current);
        setLocalLoadError(message);
        setLocalReady(true);
        notify(message, "bad");
        return undefined;
      },
    );
  }, [notify, repository]);

  useEffect(() => {
    void refreshLocal();
  }, [refreshLocal]);

  const persistLocal = useCallback(
    (
      favorites: LocalFavoriteCollection,
      reportFailure = true,
      startedEpoch?: number,
    ): Promise<boolean> => {
      const epoch = startedEpoch ?? connectionEpochRef.current;
      if (connectionEpochRef.current !== epoch) return Promise.resolve(false);
      const localFavorites = localTrackStarIndexAndRadio(favorites);
      const generation = localGenerationRef.current + 1;
      localGenerationRef.current = generation;
      committedLocalCollectionRef.current = localFavorites;
      setLocalCollection(localFavorites);
      setLocalReady(true);
      setLocalLoadError(undefined);

      return repository.write(localFavorites).then(
        (savedFavorites) => {
          if (connectionEpochRef.current !== epoch) return false;
          const savedLocalFavorites = localTrackStarIndexAndRadio(savedFavorites);
          persistedLocalCollectionRef.current = savedLocalFavorites;
          if (localGenerationRef.current === generation) {
            committedLocalCollectionRef.current = savedLocalFavorites;
            setLocalCollection(savedLocalFavorites);
          }
          return true;
        },
        (cause) => {
          if (connectionEpochRef.current !== epoch) return false;
          if (localGenerationRef.current === generation) {
            committedLocalCollectionRef.current =
              persistedLocalCollectionRef.current;
            setLocalCollection(persistedLocalCollectionRef.current);
          }
          if (reportFailure) notify(formatErrorMessage(cause), "bad");
          return false;
        },
      );
    },
    [notify, repository],
  );

  useEffect(() => {
    const wasConnected = previousConnectedRef.current;
    previousConnectedRef.current = connected;
    if (!wasConnected || connected) return;
    connectionEpochRef.current += 1;
    trackMutationRevisionRef.current.clear();
    const epoch = connectionEpochRef.current;
    void persistLocal({
      ...committedLocalCollectionRef.current,
      songIds: [],
      tracks: [],
    }, false, epoch);
  }, [connected, persistLocal]);

  const musicFavorites = useMemo(
    () => connected
      ? withLibraryAlbumMetadata(
        musicQuery.data ?? emptyMusicFavorites(),
        albums,
      )
      : emptyMusicFavorites(),
    [albums, connected, musicQuery.data],
  );
  const collection = useMemo(
    () => withLocalTrackIndexAndRadio(musicFavorites, localCollection),
    [localCollection, musicFavorites],
  );
  const ready = localReady && (!connected || !musicQuery.isPending);
  const loadError = localLoadError ??
    (musicQuery.error ? formatErrorMessage(musicQuery.error) : undefined);

  const reconcileKnownTracks = useCallback(async (
    favorites: LocalFavoriteCollection,
    reportUnavailable: boolean,
  ) => {
    const epoch = connectionEpochRef.current;
    if (!connected || !musicRepository.reconcile) return;
    const tracks = favorites.tracks.map((track) => ({
      id: track.id,
      albumId: track.albumId,
    }));
    if (!tracks.length) return;
    const capturedRevisions = new Map(trackMutationRevisionRef.current);
    try {
      const result = await musicRepository.reconcile(tracks);
      if (connectionEpochRef.current !== epoch) return;
      const fresh = trackStarReconciliationForCurrentRevisions(
        result,
        trackMutationRevisionRef.current,
        capturedRevisions,
      );
      const current = committedLocalCollectionRef.current;
      const next = reconcileLocalTrackStarIndex(
        current,
        fresh.tracks,
        fresh.unstarredIds,
      );
      await persistLocal(next, false, epoch);
      if (connectionEpochRef.current !== epoch) return;
      if (reportUnavailable && result.unavailableTrackCount > 0) {
        notify(
          `Bandcamp could not verify ${result.unavailableTrackCount.toLocaleString()} favorite ${result.unavailableTrackCount === 1 ? "track" : "tracks"}. Coda kept the last confirmed state.`,
          "bad",
        );
      }
    } catch (cause) {
      if (connectionEpochRef.current !== epoch) return;
      if (reportUnavailable) notify(formatErrorMessage(cause), "bad");
    }
  }, [connected, musicRepository, notify, persistLocal]);

  const refresh = useCallback(() => {
    const epoch = connectionEpochRef.current;
    void refreshLocal().then((favorites) => {
      if (connectionEpochRef.current !== epoch) return;
      if (favorites) void reconcileKnownTracks(favorites, true);
    });
    if (connected) {
      void musicQuery.refetch();
    }
  }, [
    connected,
    musicQuery,
    reconcileKnownTracks,
    refreshLocal,
  ]);

  const enumeratedTrackStarsSignature = useMemo(
    () => musicFavorites.tracks
      .map((track) => `${track.id}\u0000${track.starredAt ?? ""}`)
      .join("\u0001"),
    [musicFavorites.tracks],
  );

  useEffect(() => {
    if (!localReady) return;
    if (
      mergedEnumeratedTrackStarsRef.current === enumeratedTrackStarsSignature
    ) return;
    if (!musicFavorites.tracks.length) {
      mergedEnumeratedTrackStarsRef.current = enumeratedTrackStarsSignature;
      return;
    }
    try {
      const current = committedLocalCollectionRef.current;
      const next = reconcileLocalTrackStarIndex(
        current,
        musicFavorites.tracks,
      );
      mergedEnumeratedTrackStarsRef.current = enumeratedTrackStarsSignature;
      if (next === current) return;
      void persistLocal(next, false, connectionEpochRef.current);
    } catch (cause) {
      notify(formatErrorMessage(cause), "bad");
    }
  }, [
    enumeratedTrackStarsSignature,
    localCollection,
    localReady,
    musicFavorites.tracks,
    notify,
    persistLocal,
  ]);

  const hydratedTrackStarLocators = useMemo(() => {
    const seenAlbums = new Set<string>();
    const locators: FavoriteTrackLocator[] = [];
    for (const album of [selectedAlbum, ...albums]) {
      if (
        !album ||
        seenAlbums.has(album.id) ||
        !album.tracks?.some((track) => track.starredAt !== undefined)
      ) continue;
      seenAlbums.add(album.id);
      for (const track of album.tracks) {
        locators.push({ id: track.id, albumId: track.albumId || album.id });
      }
    }
    return locators;
  }, [albums, selectedAlbum]);

  useEffect(() => {
    if (
      !connected ||
      !localReady ||
      !musicRepository.reconcile ||
      !hydratedTrackStarLocators.length
    ) return;
    const indexedTrackIds = new Set(localCollection.songIds);
    if (musicFavorites.tracks.some((track) => !indexedTrackIds.has(track.id))) {
      return;
    }
    const signature = hydratedTrackStarLocators
      .map((track) => `${track.albumId}\u0000${track.id}`)
      .join("\u0001");
    const epoch = connectionEpochRef.current;
    const hydratedDedup = reconciledHydratedTrackStarsRef.current;
    if (hydratedDedup.epoch === epoch && hydratedDedup.signature === signature) {
      return;
    }
    reconciledHydratedTrackStarsRef.current = { epoch, signature };
    const capturedRevisions = new Map(trackMutationRevisionRef.current);
    void musicRepository.reconcile(hydratedTrackStarLocators).then(
      (result) => {
        if (connectionEpochRef.current !== epoch) return;
        try {
          const fresh = trackStarReconciliationForCurrentRevisions(
            result,
            trackMutationRevisionRef.current,
            capturedRevisions,
          );
          if (fresh !== result) {
            reconciledHydratedTrackStarsRef.current = { epoch, signature: "" };
          }
          const current = committedLocalCollectionRef.current;
          const next = reconcileLocalTrackStarIndex(
            current,
            fresh.tracks,
            fresh.unstarredIds,
          );
          if (next !== current) void persistLocal(next, false, epoch);
        } catch (cause) {
          reconciledHydratedTrackStarsRef.current = { epoch, signature: "" };
          notify(formatErrorMessage(cause), "bad");
        }
      },
      () => {
        if (connectionEpochRef.current !== epoch) return;
        reconciledHydratedTrackStarsRef.current = { epoch, signature: "" };
      },
    );
  }, [
    connected,
    hydratedTrackStarLocators,
    localCollection,
    localReady,
    musicFavorites.tracks,
    musicRepository,
    notify,
    persistLocal,
  ]);

  const favoriteTrackIds = useMemo(
    () => new Set(collection.songIds),
    [collection.songIds],
  );
  const favoriteAlbumIds = useMemo(
    () => new Set(collection.albumIds),
    [collection.albumIds],
  );
  const favoriteRadioShowIds = useMemo(
    () => new Set(collection.radioShowIds),
    [collection.radioShowIds],
  );

  const favoritesAvailable = useCallback(() => {
    if (ready) return true;
    notify("Favorites are still loading. Try again in a moment.", "bad");
    return false;
  }, [notify, ready]);

  const toggleFavorite = useCallback(
    (id: string, kind: FavoriteKind, favorite?: boolean) => {
      if (!favoritesAvailable()) return;
      if (!connected) {
        notify("Connect Bandcamp to update music Favorites.", "bad");
        return;
      }
      const active = kind === "song"
        ? favoriteTrackIds.has(id)
        : favoriteAlbumIds.has(id);
      const candidate = kind === "song"
        ? queue.find((track) => track.id === id) ??
          selectedAlbum?.tracks?.find((track) => track.id === id)
        : (selectedAlbum?.id === id ? selectedAlbum : undefined) ??
          albums.find((album) => album.id === id);
      const input: FavoriteInput = {
        id,
        kind,
        favorite: favorite ?? !active,
      };
      if (kind === "song" && candidate && "albumId" in candidate) {
        input.albumId = candidate.albumId;
      }
      if (
        kind === "song" &&
        input.favorite &&
        !localTrackStarIndexCanAccept(committedLocalCollectionRef.current, id)
      ) {
        notify(localTrackStarBoundMessage(), "bad");
        return;
      }

      try {
        const epoch = connectionEpochRef.current;
        const startedTrackRevision = kind === "song"
          ? bumpTrackMutationRevision(trackMutationRevisionRef.current, id)
          : 0;
        const previous = musicFavorites;
        const next = updateMusicFavorites(previous, input, candidate);
        const rollbackInput: FavoriteInput = { ...input, favorite: active };
        const rollbackCandidate = kind === "song"
          ? previous.tracks.find((track) => track.id === id) ?? candidate
          : previous.albums.find((album) => album.id === id) ?? candidate;
        const rollbackQueryFavorite = () => queryClient.setQueryData<FavoriteCollection>(
          FAVORITES_QUERY_KEY,
          (current) => updateMusicFavorites(
            current ?? previous,
            rollbackInput,
            rollbackCandidate,
          ),
        );
        queryClient.setQueryData(FAVORITES_QUERY_KEY, next);
        const persistAffectedSong = (
          apply: (current: LocalFavoriteCollection) => LocalFavoriteCollection,
        ): boolean => {
          try {
            void persistLocal(
              apply(committedLocalCollectionRef.current),
              false,
              epoch,
            );
            return true;
          } catch (cause) {
            notify(formatErrorMessage(cause), "bad");
            return false;
          }
        };
        if (kind === "song") {
          const persisted = persistAffectedSong(
            (current) => updateLocalFavorites(current, input, candidate),
          );
          if (!persisted) return;
        }
        void musicRepository.write(input).then(
          (result) => {
            if (connectionEpochRef.current !== epoch) return;
            if (
              kind === "song" &&
              currentTrackMutationRevision(
                trackMutationRevisionRef.current,
                id,
              ) !== startedTrackRevision
            ) {
              return;
            }
            if (kind === "song") {
              if (result.verification === "unavailable" && !input.favorite) {
                rollbackQueryFavorite();
                persistAffectedSong(
                  (current) => updateLocalFavorites(
                    current,
                    rollbackInput,
                    rollbackCandidate,
                  ),
                );
                notify(
                  "Bandcamp accepted the removal, but Coda could not verify it. The track will remain until Refresh confirms it.",
                  "bad",
                );
                return;
              }
              const confirmedFavorite = result.favorite ?? input.favorite;
              const confirmedInput: FavoriteInput = {
                ...input,
                favorite: confirmedFavorite,
              };
              const persisted = persistAffectedSong(
                (current) => confirmedFavorite
                  ? reconcileLocalTrackStarIndex(
                    current,
                    result.track
                      ? [result.track]
                      : candidate && "albumId" in candidate
                      ? [{ ...candidate, starredAt: new Date().toISOString() }]
                      : [],
                  )
                  : updateLocalFavorites(current, confirmedInput),
              );
              if (!persisted) return;
              if (result.verification === "mismatch") {
                queryClient.setQueryData<FavoriteCollection>(
                  FAVORITES_QUERY_KEY,
                  (current) => updateMusicFavorites(
                    current ?? previous,
                    confirmedInput,
                    result.track,
                  ),
                );
                notify(
                  "Bandcamp accepted the request but reported a different track-star state. Coda kept Bandcamp’s confirmed state.",
                  "bad",
                );
                return;
              }
            }
            notify(
              result.verification === "unavailable"
                ? "Saved to Bandcamp Subsonic Favorites. Verification will retry on Refresh."
                : input.favorite
                ? "Saved to Bandcamp Subsonic Favorites"
                : "Removed from Bandcamp Subsonic Favorites",
              "good",
            );
            void queryClient.invalidateQueries({
              queryKey: FAVORITES_QUERY_KEY,
              exact: true,
            });
          },
          (cause) => {
            if (connectionEpochRef.current !== epoch) return;
            if (
              kind === "song" &&
              currentTrackMutationRevision(
                trackMutationRevisionRef.current,
                id,
              ) !== startedTrackRevision
            ) {
              return;
            }
            rollbackQueryFavorite();
            if (kind === "song") {
              persistAffectedSong(
                (current) => updateLocalFavorites(
                  current,
                  rollbackInput,
                  rollbackCandidate,
                ),
              );
            }
            notify(formatErrorMessage(cause), "bad");
          },
        );
      } catch (cause) {
        notify(formatErrorMessage(cause), "bad");
      }
    },
    [
      albums,
      connected,
      favoriteAlbumIds,
      favoriteTrackIds,
      favoritesAvailable,
      musicFavorites,
      musicRepository,
      notify,
      persistLocal,
      queryClient,
      queue,
      selectedAlbum,
    ],
  );

  const toggleRadioFavorite = useCallback(
    (show: RadioShowSummary, favorite?: boolean) => {
      if (!favoritesAvailable()) return;
      const nextFavorite = favorite ?? !favoriteRadioShowIds.has(show.id);
      try {
        const epoch = connectionEpochRef.current;
        const next = updateLocalRadioFavorite(
          committedLocalCollectionRef.current,
          show,
          nextFavorite,
        );
        void persistLocal(next, true, epoch).then((saved) => {
          if (!saved || connectionEpochRef.current !== epoch) return;
          notify(
            nextFavorite
              ? "Radio show saved to Favorites on this device"
              : "Radio show removed from local Favorites",
            "good",
          );
        });
      } catch (cause) {
        notify(formatErrorMessage(cause), "bad");
      }
    },
    [
      favoriteRadioShowIds,
      favoritesAvailable,
      notify,
      persistLocal,
    ],
  );

  const controller = {
    collection,
    ready,
    favoriteAlbumIds,
    favoriteRadioShowIds,
    favoriteTrackIds,
    ensureReady: favoritesAvailable,
    refresh,
    toggleFavorite,
    toggleRadioFavorite,
  };
  if (loadError === undefined) return controller;
  return { ...controller, loadError };
}
