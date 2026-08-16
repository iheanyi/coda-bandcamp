import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ToastNotifier } from "@/components/ui/toastManager";
import {
  fetchFavorites,
  reconcileFavoriteTracks,
  setFavorite,
} from "@/lib";
import {
  emptyLocalFavorites,
  localTrackStarIndexAndRadio,
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

function errorMessage(cause: unknown): string {
  return String(cause).replace(/^Error:\s*/u, "");
}

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
  const persistedLocalCollectionRef = useRef<LocalFavoriteCollection>(
    emptyLocalFavorites(),
  );
  const mergedEnumeratedTrackStarsRef = useRef("");
  const reconciledHydratedTrackStarsRef = useRef("");
  const previousConnectedRef = useRef(connected);

  const refreshLocal = useCallback((): Promise<LocalFavoriteCollection | undefined> => {
    const generation = localGenerationRef.current + 1;
    localGenerationRef.current = generation;
    setLocalReady(false);
    setLocalLoadError(undefined);

    return repository.read().then(
      (favorites) => {
        if (localGenerationRef.current !== generation) return undefined;
        const localFavorites = localTrackStarIndexAndRadio(favorites);
        persistedLocalCollectionRef.current = localFavorites;
        setLocalCollection(localFavorites);
        setLocalReady(true);
        return localFavorites;
      },
      (cause) => {
        if (localGenerationRef.current !== generation) return undefined;
        const message = errorMessage(cause);
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
    ): Promise<boolean> => {
      const localFavorites = localTrackStarIndexAndRadio(favorites);
      const generation = localGenerationRef.current + 1;
      localGenerationRef.current = generation;
      setLocalCollection(localFavorites);
      setLocalReady(true);
      setLocalLoadError(undefined);

      return repository.write(localFavorites).then(
        (savedFavorites) => {
          const savedLocalFavorites = localTrackStarIndexAndRadio(savedFavorites);
          persistedLocalCollectionRef.current = savedLocalFavorites;
          if (localGenerationRef.current === generation) {
            setLocalCollection(savedLocalFavorites);
          }
          return true;
        },
        (cause) => {
          if (localGenerationRef.current === generation) {
            setLocalCollection(persistedLocalCollectionRef.current);
          }
          if (reportFailure) notify(errorMessage(cause), "bad");
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
    void persistLocal({
      ...localCollection,
      songIds: [],
      tracks: [],
    }, false);
  }, [connected, localCollection, persistLocal]);

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
    (musicQuery.error ? errorMessage(musicQuery.error) : undefined);

  const reconcileKnownTracks = useCallback(async (
    favorites: LocalFavoriteCollection,
    reportUnavailable: boolean,
  ) => {
    if (!connected || !musicRepository.reconcile) return;
    const tracks = favorites.tracks.map((track) => ({
      id: track.id,
      albumId: track.albumId,
    }));
    if (!tracks.length) return;
    try {
      const result = await musicRepository.reconcile(tracks);
      const next = reconcileLocalTrackStarIndex(
        favorites,
        result.tracks,
        result.unstarredIds,
      );
      await persistLocal(next, false);
      if (reportUnavailable && result.unavailableTrackCount > 0) {
        notify(
          `Bandcamp could not verify ${result.unavailableTrackCount.toLocaleString()} favorite ${result.unavailableTrackCount === 1 ? "track" : "tracks"}. Coda kept the last confirmed state.`,
          "bad",
        );
      }
    } catch (cause) {
      if (reportUnavailable) notify(errorMessage(cause), "bad");
    }
  }, [connected, musicRepository, notify, persistLocal]);

  const refresh = useCallback(() => {
    void refreshLocal().then((favorites) => {
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
    mergedEnumeratedTrackStarsRef.current = enumeratedTrackStarsSignature;
    if (!musicFavorites.tracks.length) return;
    const next = reconcileLocalTrackStarIndex(
      localCollection,
      musicFavorites.tracks,
    );
    if (next === localCollection) return;
    void persistLocal(next, false);
  }, [
    enumeratedTrackStarsSignature,
    localCollection,
    localReady,
    musicFavorites.tracks,
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
    if (reconciledHydratedTrackStarsRef.current === signature) return;
    reconciledHydratedTrackStarsRef.current = signature;
    void musicRepository.reconcile(hydratedTrackStarLocators).then(
      (result) => {
        const next = reconcileLocalTrackStarIndex(
          localCollection,
          result.tracks,
          result.unstarredIds,
        );
        if (next !== localCollection) void persistLocal(next, false);
      },
      () => {
        reconciledHydratedTrackStarsRef.current = "";
      },
    );
  }, [
    connected,
    hydratedTrackStarLocators,
    localCollection,
    localReady,
    musicFavorites.tracks,
    musicRepository,
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

      try {
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
        const previousLocal = localCollection;
        if (kind === "song") {
          const nextLocal = updateLocalFavorites(
            previousLocal,
            input,
            candidate,
          );
          void persistLocal(nextLocal, false);
        }
        void musicRepository.write(input).then(
          (result) => {
            if (kind === "song") {
              if (result.verification === "unavailable" && !input.favorite) {
                rollbackQueryFavorite();
                void persistLocal(previousLocal, false);
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
              const confirmedLocal = confirmedFavorite
                ? reconcileLocalTrackStarIndex(
                  previousLocal,
                  result.track ? [result.track] : candidate && "albumId" in candidate
                    ? [{ ...candidate, starredAt: new Date().toISOString() }]
                    : [],
                )
                : updateLocalFavorites(previousLocal, confirmedInput);
              void persistLocal(confirmedLocal, false);
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
            rollbackQueryFavorite();
            if (kind === "song") void persistLocal(previousLocal, false);
            notify(errorMessage(cause), "bad");
          },
        );
      } catch (cause) {
        notify(errorMessage(cause), "bad");
      }
    },
    [
      albums,
      connected,
      favoriteAlbumIds,
      favoriteTrackIds,
      favoritesAvailable,
      localCollection,
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
        const next = updateLocalRadioFavorite(
          localCollection,
          show,
          nextFavorite,
        );
        void persistLocal(next).then((saved) => {
          if (!saved) return;
          notify(
            nextFavorite
              ? "Radio show saved to Favorites on this device"
              : "Radio show removed from local Favorites",
            "good",
          );
        });
      } catch (cause) {
        notify(errorMessage(cause), "bad");
      }
    },
    [
      favoriteRadioShowIds,
      favoritesAvailable,
      localCollection,
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
