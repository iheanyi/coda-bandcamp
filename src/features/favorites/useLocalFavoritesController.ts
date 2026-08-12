import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ToastNotifier } from "@/components/ui/toastManager";
import {
  emptyLocalFavorites,
  repairLocalFavoriteMetadata,
  updateLocalFavorites,
  updateLocalRadioFavorite,
} from "@/localFavorites";
import {
  readLocalFavoritesAsync,
  writeLocalFavoritesAsync,
} from "@/localFavoritesStore";
import type {
  Album,
  LocalFavoriteCollection,
  RadioShowSummary,
  Track,
} from "@/types";

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

type FavoriteKind = "album" | "song";

export type LocalFavoritesController = Readonly<{
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
  notify: ToastNotifier;
  queue: readonly Track[];
  repository?: LocalFavoritesRepository;
  selectedAlbum?: Album;
}>;

function errorMessage(cause: unknown): string {
  return String(cause).replace(/^Error:\s*/u, "");
}

export function useLocalFavoritesController({
  albums,
  notify,
  queue,
  repository = defaultLocalFavoritesRepository,
  selectedAlbum,
}: UseLocalFavoritesControllerOptions): LocalFavoritesController {
  const [collection, setCollection] = useState<LocalFavoriteCollection>(
    emptyLocalFavorites,
  );
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const generationRef = useRef(0);
  const persistedCollectionRef = useRef<LocalFavoriteCollection>(
    emptyLocalFavorites(),
  );

  const refresh = useCallback(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setReady(false);
    setLoadError(undefined);

    void repository.read().then(
      (favorites) => {
        if (generationRef.current !== generation) return;
        persistedCollectionRef.current = favorites;
        setCollection(favorites);
        setReady(true);
      },
      (cause) => {
        if (generationRef.current !== generation) return;
        const message = errorMessage(cause);
        setCollection(persistedCollectionRef.current);
        setLoadError(message);
        setReady(true);
        notify(message, "bad");
      },
    );
  }, [notify, repository]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const persist = useCallback(
    (
      favorites: LocalFavoriteCollection,
      reportFailure = true,
    ): Promise<boolean> => {
      const generation = generationRef.current + 1;
      generationRef.current = generation;
      setCollection(favorites);
      setReady(true);
      setLoadError(undefined);

      return repository.write(favorites).then(
        (savedFavorites) => {
          persistedCollectionRef.current = savedFavorites;
          if (generationRef.current === generation) {
            setCollection(savedFavorites);
          }
          return true;
        },
        (cause) => {
          if (generationRef.current === generation) {
            setCollection(persistedCollectionRef.current);
          }
          if (reportFailure) notify(errorMessage(cause), "bad");
          return false;
        },
      );
    },
    [notify, repository],
  );

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

  const localFavoriteTrackCandidates = useMemo(() => {
    const existing = new Set(collection.tracks.map((track) => track.id));
    const missing = new Set(
      collection.songIds.filter((id) => !existing.has(id)),
    );
    if (!missing.size) return [];

    const candidates: Track[] = [];
    const collect = (tracks: readonly Track[]) => {
      for (const track of tracks) {
        if (!missing.delete(track.id)) continue;
        candidates.push(track);
        if (!missing.size) return true;
      }
      return false;
    };

    if (collect(queue) || collect(selectedAlbum?.tracks ?? [])) {
      return candidates;
    }
    for (const album of albums) {
      if (collect(album.tracks ?? [])) break;
    }
    return candidates;
  }, [albums, collection.songIds, collection.tracks, queue, selectedAlbum]);

  useEffect(() => {
    if (!ready) return;
    const repaired = repairLocalFavoriteMetadata(
      collection,
      albums,
      localFavoriteTrackCandidates,
    );
    if (repaired === collection) return;
    void persist(repaired, false);
  }, [
    albums,
    collection,
    localFavoriteTrackCandidates,
    persist,
    ready,
  ]);

  const favoritesAvailable = useCallback(() => {
    if (ready) return true;
    notify("Favorites are still loading. Try again in a moment.", "bad");
    return false;
  }, [notify, ready]);

  const toggleFavorite = useCallback(
    (id: string, kind: FavoriteKind, favorite?: boolean) => {
      if (!favoritesAvailable()) return;
      const active = kind === "song"
        ? favoriteTrackIds.has(id)
        : favoriteAlbumIds.has(id);
      const input = { id, kind, favorite: favorite ?? !active };
      const candidate = kind === "song"
        ? queue.find((track) => track.id === id) ??
          selectedAlbum?.tracks?.find((track) => track.id === id)
        : (selectedAlbum?.id === id ? selectedAlbum : undefined) ??
          albums.find((album) => album.id === id);

      try {
        const next = updateLocalFavorites(collection, input, candidate);
        void persist(next).then((saved) => {
          if (!saved) return;
          notify(
            input.favorite
              ? "Saved to Favorites on this device"
              : "Removed from local Favorites",
            "good",
          );
        });
      } catch (cause) {
        notify(errorMessage(cause), "bad");
      }
    },
    [
      albums,
      collection,
      favoriteAlbumIds,
      favoriteTrackIds,
      favoritesAvailable,
      notify,
      persist,
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
          collection,
          show,
          nextFavorite,
        );
        void persist(next).then((saved) => {
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
      collection,
      favoriteRadioShowIds,
      favoritesAvailable,
      notify,
      persist,
    ],
  );

  return {
    collection,
    ready,
    ...(loadError === undefined ? {} : { loadError }),
    favoriteAlbumIds,
    favoriteRadioShowIds,
    favoriteTrackIds,
    ensureReady: favoritesAvailable,
    refresh,
    toggleFavorite,
    toggleRadioFavorite,
  };
}
