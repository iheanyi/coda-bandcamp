import type { QueryClient } from "@tanstack/react-query";
import type { ToastNotifier } from "@/components/ui/toastManager";
import { countLabel } from "@/countLabel";
import {
  clearRuntimeCaches,
  disconnect,
  fetchLibrary,
  hasConnection,
  type LibraryCacheSnapshot,
  type LibrarySyncProgress,
} from "@/lib";
import { clearCoverArtRendererState } from "@/coverArtSource";
import {
  albumQueryKey,
  cachedAlbumTracks,
  clearBandcampQueryData,
  ensureAlbumQueryData,
  hydrateLibraryQuery,
  libraryQueryKey,
  mergeLibraryProgress,
  refreshAlbumQueryData,
  shouldAutoRevalidateLibrary,
  toLibrarySummaries,
  updateLibraryData,
} from "@/libraryQueries";
import {
  awaitLibraryStartupStep,
  LIBRARY_STARTUP_STEP_TIMEOUT_MS,
} from "@/libraryStartup";
import type { Album, Track } from "@/types";

export const LIBRARY_METADATA_CONCURRENCY = 6;
export const ARTWORK_REFRESH_CONCURRENCY = 4;
export const MAX_ARTWORK_DETAILS_PER_REFRESH = 200;

const CONNECTION_TIMEOUT_MESSAGE =
  "Checking your saved connection took too long. Try again.";
const CACHE_TIMEOUT_MESSAGE = "Loading your saved collection took too long.";
const SYNC_FALLBACK_MESSAGE =
  "Coda could not sync your Bandcamp collection. Try again.";

export type LibraryConnectionStatus = "checking" | "connected" | "disconnected";

export type LibrarySyncStatus = "checking" | "idle" | "syncing" | "error";

export type LibrarySyncProgressState = Readonly<{
  loaded: number;
  pageIndex: number;
}>;

export type LibraryArtworkProgressState = Readonly<{
  checked: number;
  recovered: number;
  total: number;
}>;

export type LibrarySessionState = Readonly<{
  artwork: Readonly<{
    progress?: LibraryArtworkProgressState;
    refreshing: boolean;
  }>;
  connection: LibraryConnectionStatus;
  sync: Readonly<{
    error: string;
    progress?: LibrarySyncProgressState;
    status: LibrarySyncStatus;
  }>;
}>;

export type LibraryAlbumLoadMode = "activate" | "preload";

export type LibraryAlbumBatchProgress = Readonly<{
  completed: number;
  failed: number;
  recovered: number;
  total: number;
}>;

export type LibraryAlbumBatchResult = Readonly<{
  albums: readonly (Album | undefined)[];
  failed: number;
  stale: boolean;
}>;

export type EnsureLibraryAlbumsOptions = Readonly<{
  concurrency?: number;
  mode?: LibraryAlbumLoadMode;
  onProgress?: (progress: LibraryAlbumBatchProgress) => void;
}>;

export type LibraryArtworkRefreshResult = Readonly<{
  checked: number;
  recovered: number;
  stale: boolean;
  unchecked: number;
}>;

export type LibrarySyncOptions = Readonly<{
  announce?: boolean;
  forceFull?: boolean;
}>;

export type LibrarySessionGeneration = Readonly<{
  current: () => number;
  isCurrent: (generation: number) => boolean;
}>;

export type LibrarySessionCommands = Readonly<{
  acceptConnectedLibrary: (
    albums: readonly Album[],
    options?: Readonly<{ announce?: boolean }>,
  ) => void;
  disconnect: () => Promise<void>;
  ensureAlbum: (
    album: Album,
    mode?: LibraryAlbumLoadMode,
  ) => Promise<Album | undefined>;
  ensureAlbums: (
    albums: readonly Album[],
    options?: EnsureLibraryAlbumsOptions,
  ) => Promise<LibraryAlbumBatchResult>;
  generation: LibrarySessionGeneration;
  refreshArtwork: () => Promise<LibraryArtworkRefreshResult>;
  retryStartup: () => Promise<void>;
  sync: (options?: LibrarySyncOptions) => Promise<void>;
}>;

export type LibrarySessionRouteSnapshot = Readonly<{
  canPreloadAuthenticatedRoute: boolean;
  connection: LibraryConnectionStatus;
  ready: boolean;
}>;

/**
 * A narrow router dependency. Reads are synchronous and cache-only. The one
 * write-through method is nonblocking and can start Query album hydration only
 * after startup has resolved the authenticated connection.
 */
export type LibrarySessionRouteReader = Readonly<{
  findCachedAlbum: (albumId: string) => Album | undefined;
  findCachedAlbumTracks: (albumId: string) => readonly Track[] | undefined;
  getSnapshot: () => LibrarySessionRouteSnapshot;
  preloadAlbum: (album: string | Album) => void;
}>;

export type LibrarySessionDependencies = Readonly<{
  checkConnection: () => Promise<boolean>;
  clearArtworkUrls: () => void;
  clearRuntimeData: () => void;
  disconnect: () => Promise<string | undefined>;
  emitArtworkRefresh: () => void;
  ensureAlbumTracks: (
    queryClient: QueryClient,
    album: Album,
  ) => Promise<Track[]>;
  loadCachedLibrary: () => Promise<LibraryCacheSnapshot | undefined>;
  refreshAlbumTracks: (
    queryClient: QueryClient,
    album: Album,
  ) => Promise<Track[]>;
  syncLibrary: (
    onPage: (progress: LibrarySyncProgress) => void,
    options: Readonly<{ forceFull: boolean }>,
  ) => Promise<Album[]>;
}>;

export type CreateLibrarySessionControllerOptions = Readonly<{
  dependencies?: Partial<LibrarySessionDependencies>;
  notify?: ToastNotifier;
  queryClient: QueryClient;
  startupTimeoutMs?: number;
}>;

export type LibrarySessionController = Readonly<{
  activate: () => () => void;
  commands: LibrarySessionCommands;
  getSnapshot: () => LibrarySessionState;
  route: LibrarySessionRouteReader;
  subscribe: (listener: () => void) => () => void;
}>;

const EMPTY_ARTWORK_STATE = Object.freeze({ refreshing: false });
const INITIAL_SYNC_STATE = Object.freeze({
  error: "",
  status: "checking" as const,
});
const INITIAL_STATE: LibrarySessionState = Object.freeze({
  artwork: EMPTY_ARTWORK_STATE,
  connection: "checking",
  sync: INITIAL_SYNC_STATE,
});

const defaultDependencies: LibrarySessionDependencies = {
  checkConnection: hasConnection,
  clearArtworkUrls: clearCoverArtRendererState,
  clearRuntimeData: clearRuntimeCaches,
  disconnect,
  emitArtworkRefresh: () => {
    window.dispatchEvent(new Event("coda:refresh-artwork"));
  },
  ensureAlbumTracks: ensureAlbumQueryData,
  loadCachedLibrary: hydrateLibraryQuery,
  refreshAlbumTracks: refreshAlbumQueryData,
  syncLibrary: fetchLibrary,
};

function freezeState(state: LibrarySessionState): LibrarySessionState {
  const artwork = Object.freeze(
    state.artwork.progress
      ? {
          progress: Object.freeze({ ...state.artwork.progress }),
          refreshing: state.artwork.refreshing,
        }
      : { refreshing: state.artwork.refreshing },
  );
  const sync = Object.freeze(
    state.sync.progress
      ? {
          error: state.sync.error,
          progress: Object.freeze({ ...state.sync.progress }),
          status: state.sync.status,
        }
      : {
          error: state.sync.error,
          status: state.sync.status,
        },
  );
  return Object.freeze({ artwork, connection: state.connection, sync });
}

function isPrimitiveString<Value>(value: Value): value is Value & string {
  return (
    Object.prototype.toString.call(value) === "[object String]" &&
    value === String(value)
  );
}

function errorMessage(cause: unknown, fallback: string): string {
  const message =
    cause instanceof Error
      ? cause.message
      : isPrimitiveString(cause)
        ? cause
        : fallback;
  const normalized = message
    .replace(/^Error:\s*/, "")
    .replace(/https?:\/\/\S+/gi, "[redacted URL]")
    .replace(
      /(password|token|secret|credential)(\s*[:=]\s*)\S+/gi,
      "$1$2[redacted]",
    )
    .replace(/[\r\n\t]+/g, " ")
    .trim();
  return (normalized || fallback).slice(0, 300);
}

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

function sessionLibrarySummaries(albums: readonly Album[]): Album[] {
  return toLibrarySummaries(albums).map((album) => {
    const { artworkUrl: _signedArtworkUrl, ...summary } = album;
    return summary;
  });
}

function routeSafeAlbum(album: Album): Album {
  const { artworkUrl: _signedArtworkUrl, tracks: _tracks, ...summary } = album;
  const safeAlbum: Album = {
    ...summary,
    palette: [album.palette[0], album.palette[1]],
  };
  return Object.freeze(safeAlbum);
}

function routeSafeTrack(track: Track): Track {
  const {
    artworkUrl: _signedArtworkUrl,
    discoverRelease: _discoverRelease,
    radioChapters: _radioChapters,
    streamUrl: _signedStreamUrl,
    ...metadata
  } = track;
  const safeTrack: Track = {
    ...metadata,
    palette: [track.palette[0], track.palette[1]],
  };
  return Object.freeze(safeTrack);
}

function boundedConcurrency(requested: number | undefined, total: number) {
  if (!total) return 0;
  if (!Number.isFinite(requested)) {
    return Math.min(LIBRARY_METADATA_CONCURRENCY, total);
  }
  return Math.min(
    LIBRARY_METADATA_CONCURRENCY,
    total,
    Math.max(1, Math.floor(requested ?? LIBRARY_METADATA_CONCURRENCY)),
  );
}

function routeSnapshot(
  connection: LibraryConnectionStatus,
  disconnecting = false,
): LibrarySessionRouteSnapshot {
  return Object.freeze({
    canPreloadAuthenticatedRoute: connection === "connected" && !disconnecting,
    connection,
    ready: connection !== "checking",
  });
}

export function createLibrarySessionController({
  dependencies: dependencyOverrides,
  notify = () => undefined,
  queryClient,
  startupTimeoutMs = LIBRARY_STARTUP_STEP_TIMEOUT_MS,
}: CreateLibrarySessionControllerOptions): LibrarySessionController {
  const dependencies: LibrarySessionDependencies = {
    ...defaultDependencies,
    ...dependencyOverrides,
  };
  const listeners = new Set<() => void>();
  let state = INITIAL_STATE;
  let activationCount = 0;
  let lifecycleGeneration = 0;
  let syncGeneration = 0;
  let sessionGeneration = 0;
  let connectionCheck: Promise<boolean> | undefined;
  let artworkRefresh: Promise<LibraryArtworkRefreshResult> | undefined;
  let disconnectRequest: Promise<void> | undefined;
  const albumPreloads = new Map<
    string,
    Readonly<{ generation: number; promise: Promise<void> }>
  >();

  const publish = (next: LibrarySessionState) => {
    const frozen = freezeState(next);
    if (
      frozen.connection === state.connection &&
      frozen.sync.status === state.sync.status &&
      frozen.sync.error === state.sync.error &&
      frozen.sync.progress?.loaded === state.sync.progress?.loaded &&
      frozen.sync.progress?.pageIndex === state.sync.progress?.pageIndex &&
      frozen.artwork.refreshing === state.artwork.refreshing &&
      frozen.artwork.progress?.checked === state.artwork.progress?.checked &&
      frozen.artwork.progress?.recovered ===
        state.artwork.progress?.recovered &&
      frozen.artwork.progress?.total === state.artwork.progress?.total
    ) {
      return;
    }
    state = frozen;
    for (const listener of listeners) listener();
  };

  const setConnection = (connection: LibraryConnectionStatus) => {
    publish({ ...state, connection });
  };

  const setSync = (
    status: LibrarySyncStatus,
    error = "",
    progress?: LibrarySyncProgressState,
  ) => {
    publish({
      ...state,
      sync: progress ? { error, progress, status } : { error, status },
    });
  };

  const setArtwork = (
    refreshing: boolean,
    progress?: LibraryArtworkProgressState,
  ) => {
    publish({
      ...state,
      artwork: progress ? { progress, refreshing } : { refreshing },
    });
  };

  const cancelAuthenticatedQueries = () => {
    // Query cancellation takes effect synchronously even though the returned
    // promise waits for observer notification. Removing afterward prevents a
    // late native response from restoring an old authenticated session.
    void queryClient
      .cancelQueries({ queryKey: ["bandcamp"] })
      .catch(() => undefined);
  };

  const clearAuthenticatedQueries = () => {
    cancelAuthenticatedQueries();
    clearBandcampQueryData(queryClient);
  };

  const isCurrentSession = (generation: number) =>
    generation === sessionGeneration;

  const resolveConnection = (force: boolean) => {
    if (force) connectionCheck = undefined;
    connectionCheck ??= dependencies.checkConnection();
    return connectionCheck;
  };

  const runSync = async ({
    announce = true,
    forceFull = true,
  }: LibrarySyncOptions = {}) => {
    if (state.connection !== "connected" || disconnectRequest) return;
    const operationGeneration = ++syncGeneration;
    const connectionGeneration = sessionGeneration;
    const previousLibrary =
      queryClient.getQueryData<Album[]>(libraryQueryKey) ?? [];
    setSync("syncing");
    try {
      const library = await dependencies.syncLibrary(
        (progress) => {
          if (
            operationGeneration !== syncGeneration ||
            !isCurrentSession(connectionGeneration)
          ) {
            return;
          }
          updateLibraryData(queryClient, (current) =>
            sessionLibrarySummaries(mergeLibraryProgress(current, progress)),
          );
          setSync("syncing", "", {
            loaded: progress.loaded,
            pageIndex: progress.pageIndex,
          });
        },
        { forceFull },
      );
      if (
        operationGeneration !== syncGeneration ||
        !isCurrentSession(connectionGeneration)
      ) {
        return;
      }
      updateLibraryData(queryClient, sessionLibrarySummaries(library));
      setConnection("connected");
      setSync("idle");
      if (announce) {
        notify(`${countLabel(library.length, "album")} synced`, "good");
      }
    } catch (cause) {
      if (
        operationGeneration !== syncGeneration ||
        !isCurrentSession(connectionGeneration)
      ) {
        return;
      }
      updateLibraryData(queryClient, previousLibrary);
      const message = errorMessage(cause, SYNC_FALLBACK_MESSAGE);
      setSync("error", message);
      if (announce) notify(message, "bad");
    }
  };

  const runStartup = async (forceConnectionCheck: boolean) => {
    const operationGeneration = ++lifecycleGeneration;
    ++syncGeneration;
    setConnection("checking");
    setSync("checking");
    try {
      const connected = await awaitLibraryStartupStep(
        resolveConnection(forceConnectionCheck),
        CONNECTION_TIMEOUT_MESSAGE,
        startupTimeoutMs,
      );
      if (operationGeneration !== lifecycleGeneration) return;

      if (!connected) {
        ++sessionGeneration;
        albumPreloads.clear();
        dependencies.clearRuntimeData();
        clearAuthenticatedQueries();
        setConnection("disconnected");
        setSync("idle");
        return;
      }

      setConnection("connected");
      const snapshot = await awaitLibraryStartupStep(
        dependencies.loadCachedLibrary(),
        CACHE_TIMEOUT_MESSAGE,
        startupTimeoutMs,
      ).catch(() => undefined);
      if (operationGeneration !== lifecycleGeneration) return;

      if (snapshot) {
        queryClient.setQueryData(
          libraryQueryKey,
          sessionLibrarySummaries(snapshot.albums),
          { updatedAt: snapshot.savedAt },
        );
        if (!shouldAutoRevalidateLibrary(snapshot)) {
          setSync("idle");
          return;
        }
      }
      await runSync({ announce: false, forceFull: false });
    } catch (cause) {
      if (operationGeneration !== lifecycleGeneration) return;
      setSync("error", errorMessage(cause, CONNECTION_TIMEOUT_MESSAGE));
    }
  };

  const updateRecoveredCovers = (recovered: ReadonlyMap<string, Album>) => {
    if (!recovered.size) return;
    updateLibraryData(queryClient, (albums) =>
      albums.map((album) => recovered.get(album.id) ?? album),
    );
  };

  const loadAlbums = async (
    albums: readonly Album[],
    {
      concurrency,
      mode = "activate",
      onProgress,
    }: EnsureLibraryAlbumsOptions = {},
    forceRefresh = false,
  ): Promise<LibraryAlbumBatchResult> => {
    const results: (Album | undefined)[] = Array.from(
      { length: albums.length },
      () => undefined,
    );
    if (!albums.length) {
      return Object.freeze({
        albums: Object.freeze(results),
        failed: 0,
        stale: false,
      });
    }

    if (state.connection !== "connected" || disconnectRequest) {
      return Object.freeze({
        albums: Object.freeze(results),
        failed: 0,
        stale: true,
      });
    }

    const generation = sessionGeneration;
    const recovered = new Map<string, Album>();
    let cursor = 0;
    let completed = 0;
    let failed = 0;
    const reportProgress = () => {
      if (!isCurrentSession(generation)) return;
      onProgress?.(
        Object.freeze({
          completed,
          failed,
          recovered: recovered.size,
          total: albums.length,
        }),
      );
    };
    const worker = async () => {
      while (isCurrentSession(generation) && cursor < albums.length) {
        const index = cursor;
        cursor += 1;
        const album = albums[index];
        try {
          const tracks = forceRefresh
            ? await dependencies.refreshAlbumTracks(queryClient, album)
            : await dependencies.ensureAlbumTracks(queryClient, album);
          if (!isCurrentSession(generation)) return;
          queryClient.setQueryData(albumQueryKey(album.id), tracks);
          const hydrated = albumWithTracks(
            mode === "preload" ? routeSafeAlbum(album) : album,
            mode === "preload" ? tracks.map(routeSafeTrack) : tracks,
          );
          results[index] = hydrated;
          const recoveredAlbum = albumWithRecoveredCover(album, tracks);
          if (recoveredAlbum !== album) {
            recovered.set(album.id, recoveredAlbum);
          }
        } catch {
          if (!isCurrentSession(generation)) return;
          failed += 1;
        } finally {
          if (isCurrentSession(generation)) {
            completed += 1;
            if (completed === albums.length || completed % 4 === 0) {
              reportProgress();
            }
          }
        }
      }
    };

    await Promise.all(
      Array.from(
        { length: boundedConcurrency(concurrency, albums.length) },
        () => worker(),
      ),
    );
    const stale = !isCurrentSession(generation);
    if (!stale) updateRecoveredCovers(recovered);
    return Object.freeze({
      albums: Object.freeze(results),
      failed,
      stale,
    });
  };

  const ensureAlbums: LibrarySessionCommands["ensureAlbums"] = (
    albums,
    options,
  ) => loadAlbums(albums, options);

  const ensureAlbum: LibrarySessionCommands["ensureAlbum"] = async (
    album,
    mode = "activate",
  ) => {
    const result = await loadAlbums([album], { concurrency: 1, mode });
    if (result.stale) return undefined;
    if (!result.albums[0] && mode === "activate") {
      throw new Error(`Bandcamp did not return metadata for ${album.title}.`);
    }
    return result.albums[0];
  };

  const refreshArtworkCommand = (): Promise<LibraryArtworkRefreshResult> => {
    if (artworkRefresh) return artworkRefresh;
    if (state.connection !== "connected") {
      return Promise.resolve(
        Object.freeze({
          checked: 0,
          recovered: 0,
          stale: true,
          unchecked: 0,
        }),
      );
    }

    const generation = sessionGeneration;
    const albums = queryClient.getQueryData<Album[]>(libraryQueryKey) ?? [];
    const allMissing = albums.filter((album) => !album.coverArt);
    const missing = allMissing.slice(0, MAX_ARTWORK_DETAILS_PER_REFRESH);
    const unchecked = Math.max(0, allMissing.length - missing.length);
    setArtwork(true, { checked: 0, recovered: 0, total: missing.length });
    dependencies.clearArtworkUrls();
    dependencies.emitArtworkRefresh();

    let recoveredCount = 0;
    const request = (async () => {
      const result = await loadAlbums(
        missing,
        {
          concurrency: ARTWORK_REFRESH_CONCURRENCY,
          onProgress: ({ completed, recovered }) => {
            setArtwork(true, {
              checked: completed,
              recovered,
              total: missing.length,
            });
          },
        },
        true,
      );
      if (result.stale || !isCurrentSession(generation)) {
        return Object.freeze({
          checked: 0,
          recovered: 0,
          stale: true,
          unchecked,
        });
      }
      recoveredCount = result.albums.reduce(
        (count, album, index) =>
          count + (album?.coverArt && !missing[index].coverArt ? 1 : 0),
        0,
      );
      setArtwork(true, {
        checked: missing.length,
        recovered: recoveredCount,
        total: missing.length,
      });
      if (recoveredCount) {
        notify(
          `${countLabel(recoveredCount, "missing cover")} recovered`,
          "good",
        );
      } else if (missing.length || unchecked) {
        notify(
          "Artwork links refreshed; Bandcamp did not return additional missing covers.",
        );
      } else {
        notify("Artwork refreshed", "good");
      }
      return Object.freeze({
        checked: missing.length,
        recovered: recoveredCount,
        stale: false,
        unchecked,
      });
    })().finally(() => {
      if (isCurrentSession(generation)) setArtwork(false);
      artworkRefresh = undefined;
    });
    artworkRefresh = request;
    return request;
  };

  const acceptConnectedLibrary: LibrarySessionCommands["acceptConnectedLibrary"] =
    (albums, { announce = true } = {}) => {
      ++lifecycleGeneration;
      ++syncGeneration;
      ++sessionGeneration;
      albumPreloads.clear();
      connectionCheck = Promise.resolve(true);
      artworkRefresh = undefined;
      clearAuthenticatedQueries();
      updateLibraryData(queryClient, sessionLibrarySummaries(albums));
      setArtwork(false);
      setConnection("connected");
      setSync("idle");
      if (announce) {
        notify(`${countLabel(albums.length, "album")} synced`, "good");
      }
    };

  const disconnectCommand = async () => {
    if (disconnectRequest) return disconnectRequest;
    const request = dependencies.disconnect().then(
      (cleanupWarning) => {
        ++lifecycleGeneration;
        ++syncGeneration;
        ++sessionGeneration;
        albumPreloads.clear();
        artworkRefresh = undefined;
        cancelAuthenticatedQueries();
        dependencies.clearRuntimeData();
        clearAuthenticatedQueries();
        connectionCheck = undefined;
        setArtwork(false);
        setConnection("disconnected");
        setSync("idle");
        notify("Bandcamp credentials removed", "good");
        if (cleanupWarning) notify(cleanupWarning, "bad");
      },
      (cause) => {
        throw cause;
      },
    );
    disconnectRequest = request.finally(() => {
      disconnectRequest = undefined;
    });
    return disconnectRequest;
  };

  const retryStartup = async () => {
    connectionCheck = undefined;
    await runStartup(true);
  };

  const generation = Object.freeze<LibrarySessionGeneration>({
    current: () => sessionGeneration,
    isCurrent: isCurrentSession,
  });
  const commands = Object.freeze<LibrarySessionCommands>({
    acceptConnectedLibrary,
    disconnect: disconnectCommand,
    ensureAlbum,
    ensureAlbums,
    generation,
    refreshArtwork: refreshArtworkCommand,
    retryStartup,
    sync: runSync,
  });
  const route = Object.freeze<LibrarySessionRouteReader>({
    findCachedAlbum: (albumId) => {
      const album = queryClient
        .getQueryData<Album[]>(libraryQueryKey)
        ?.find((candidate) => candidate.id === albumId);
      return album ? routeSafeAlbum(album) : undefined;
    },
    findCachedAlbumTracks: (albumId) => {
      const album = queryClient
        .getQueryData<Album[]>(libraryQueryKey)
        ?.find((candidate) => candidate.id === albumId);
      if (!album) return undefined;
      return cachedAlbumTracks(queryClient, album)?.map(routeSafeTrack);
    },
    getSnapshot: () =>
      routeSnapshot(state.connection, Boolean(disconnectRequest)),
    preloadAlbum: (albumOrId) => {
      if (state.connection !== "connected" || disconnectRequest) return;
      const album =
        isPrimitiveString(albumOrId)
          ? queryClient
              .getQueryData<Album[]>(libraryQueryKey)
              ?.find((candidate) => candidate.id === albumOrId)
          : albumOrId;
      if (!album) return;
      const generation = sessionGeneration;
      const existing = albumPreloads.get(album.id);
      if (existing?.generation === generation) return;

      const safeAlbum = routeSafeAlbum(album);
      let promise!: Promise<void>;
      promise = Promise.resolve()
        .then(() => dependencies.ensureAlbumTracks(queryClient, safeAlbum))
        .then((tracks) => {
          if (!isCurrentSession(generation)) return;
          queryClient.setQueryData(albumQueryKey(album.id), tracks);
          const recovered = albumWithRecoveredCover(safeAlbum, tracks);
          if (recovered !== safeAlbum) {
            updateRecoveredCovers(new Map([[album.id, recovered]]));
          }
        })
        .catch(() => undefined)
        .finally(() => {
          if (albumPreloads.get(album.id)?.promise === promise) {
            albumPreloads.delete(album.id);
          }
        });
      albumPreloads.set(album.id, { generation, promise });
    },
  });

  const activate = () => {
    activationCount += 1;
    if (activationCount === 1 && state.sync.status === "checking") {
      void runStartup(false);
    }
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      activationCount = Math.max(0, activationCount - 1);
      if (activationCount === 0) {
        ++lifecycleGeneration;
        ++syncGeneration;
        ++sessionGeneration;
        albumPreloads.clear();
        artworkRefresh = undefined;
        setArtwork(false);
      }
    };
  };

  return Object.freeze({
    activate,
    commands,
    getSnapshot: () => state,
    route,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}
