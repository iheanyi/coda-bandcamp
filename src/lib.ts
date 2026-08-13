import { Channel, invoke } from "@tauri-apps/api/core";
import { clearCoverArtRendererState } from "./coverArtSource";
import { normalizeGenre } from "./genres";
import {
  createPlayerStateCheckpoint,
  parsePlayerStateAsync,
  PLAYER_STATE_CONTRACT_VERSION,
} from "./playerState";
import {
  preparePlayerStateSnapshot,
  waitForPlayerStateIdle,
} from "./playerStatePreparation";
import type {
  Album,
  ConnectionInput,
  DailyArticle,
  DailyArticlesPage,
  DailyCategory,
  DiscoverFilters,
  DiscoverPage,
  FavoriteCollection,
  FavoriteInput,
  FavoriteMutationResult,
  FavoriteTrackLocator,
  FavoriteTrackReconciliation,
  LastFmAuthorization,
  LastFmStatus,
  LastFmTrackInput,
  PlaylistDetail,
  PlaylistSummary,
  PlaylistUpdateInput,
  PlayerStateCheckpoint,
  PlayerStateInput,
  PlayerStateSnapshot,
  RadioShow,
  RadioShowsPage,
  Track,
} from "./types";
import { isItemDate } from "./libraryDates";

export const isDesktop = () => "__TAURI_INTERNALS__" in window;
const isWindowsDesktop = () =>
  isDesktop() && navigator.userAgent.includes("Windows");

const LIBRARY_CACHE_KEY = "coda.library.v1";
const LIBRARY_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CACHED_ALBUMS = 5_000;
const MAX_MEDIA_URLS = 512;
const STREAM_URL_CACHE_TTL_MS = 10 * 60 * 1_000;

type LibraryCache = {
  savedAt: number;
  albums: Album[];
};

export type LibraryCacheSnapshot = {
  savedAt: number;
  lastFullSyncAt: number;
  albums: Album[];
};

export type LibrarySyncProgress = {
  pageIndex: number;
  loaded: number;
  albums: Album[];
};

export type SystemMediaMetadataInput = {
  title: string;
  artist: string;
  album: string;
  artwork?:
    | { kind: "cover"; coverArtId: string }
    | { kind: "remote"; url: string };
  canPrevious: boolean;
  canNext: boolean;
};

export type CoverCacheDiagnostics = {
  entryCount: number;
  totalBytes: number;
  hitCount: number;
  missCount: number;
  staleCount: number;
  cleanupPending: boolean;
};

export type SystemMediaControlEvent = {
  action: "play" | "pause" | "previous" | "next" | "seek";
  positionSeconds?: number;
};

type NativeLibrarySyncEvent = {
  kind: "page";
  pageIndex: number;
  loaded: number;
  albums: Omit<Album, "palette">[];
};

type RuntimeCacheEntry<T> = {
  promise: Promise<T>;
  expiresAt: number;
  value?: T;
};

const streamUrlCache = new Map<string, RuntimeCacheEntry<string>>();
let playerStateContractVersionRequest: Promise<number> | undefined;

async function nativePlayerStateContractVersion(): Promise<number> {
  if (!playerStateContractVersionRequest) {
    playerStateContractVersionRequest = invoke<number>("player_state_contract_version")
      // An older native process will not know this command while Tauri is
      // rebuilding. Keep the durable queue compatible until it restarts.
      .catch(() => 1);
  }
  return playerStateContractVersionRequest;
}

function forNativePlayerStateContract<
  T extends { radioScrobbleProgress?: unknown },
>(value: T, contractVersion: number): T | Omit<T, "radioScrobbleProgress"> {
  if (contractVersion >= PLAYER_STATE_CONTRACT_VERSION) return value;
  const { radioScrobbleProgress: _unsupported, ...legacy } = value;
  return legacy;
}

const palettes: [string, string][] = [
  ["#cf6046", "#2f2624"],
  ["#d6a84d", "#313025"],
  ["#5f8a80", "#1e302f"],
  ["#9e6a91", "#30252e"],
  ["#6d7fa8", "#222936"],
  ["#b97653", "#33271f"],
  ["#66845d", "#243024"],
  ["#8e6d4b", "#332b24"],
];

export function paletteFor(id: string): [string, string] {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  }
  return palettes[hash % palettes.length];
}

export function hydrateAlbum(album: Omit<Album, "palette">): Album {
  return {
    ...album,
    genre: normalizeGenre(album.genre),
    palette: paletteFor(album.id),
  };
}

export function hydrateTrack(
  track: Omit<Track, "palette">,
  fallbackPalette?: [string, string],
): Track {
  return {
    ...track,
    palette: fallbackPalette ?? paletteFor(track.albumId || track.id),
  };
}

function rememberPromise<T>(
  cache: Map<string, RuntimeCacheEntry<T>>,
  key: string,
  load: () => Promise<T>,
  limit: number,
  ttlMs: number,
): Promise<T> {
  const now = Date.now();
  const existing = cache.get(key);
  if (existing && existing.expiresAt > now) {
    cache.delete(key);
    cache.set(key, existing);
    return existing.promise;
  }
  if (existing) {
    cache.delete(key);
  }

  let request: Promise<T>;
  request = load()
    .then((value) => {
      const entry = cache.get(key);
      if (entry?.promise === request) entry.value = value;
      return value;
    })
    .catch((error) => {
      if (cache.get(key)?.promise === request) {
        cache.delete(key);
      }
      throw error;
    });
  cache.set(key, {
    promise: request,
    expiresAt: now + ttlMs,
  });
  if (cache.size > limit) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  return request;
}

function readRememberedValue<T>(
  cache: Map<string, RuntimeCacheEntry<T>>,
  key: string,
): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function isCachedAlbum(value: unknown): value is Album {
  if (!value || typeof value !== "object") return false;
  const album = value as Partial<Album>;
  return (
    typeof album.id === "string" &&
    typeof album.title === "string" &&
    typeof album.artist === "string" &&
    typeof album.songCount === "number" &&
    typeof album.duration === "number" &&
    (album.year === undefined ||
      (Number.isInteger(album.year) && album.year > 0 && album.year <= 9_999)) &&
    Array.isArray(album.palette) &&
    album.palette.length === 2 &&
    album.palette.every((color) => typeof color === "string")
  );
}

function stripAlbumForCache(album: Album): Album {
  const addedAt = typeof album.addedAt === "string" ? album.addedAt : undefined;
  const starredAt =
    typeof album.starredAt === "string" ? album.starredAt : undefined;
  const playedAt = typeof album.playedAt === "string" ? album.playedAt : undefined;
  const originalReleaseDate = isItemDate(album.originalReleaseDate)
    ? album.originalReleaseDate
    : undefined;
  const releaseDate = isItemDate(album.releaseDate)
    ? album.releaseDate
    : undefined;
  return {
    id: album.id,
    title: album.title,
    artist: album.artist,
    songCount: album.songCount,
    duration: album.duration,
    ...(album.coverArt === undefined ? {} : { coverArt: album.coverArt }),
    ...(album.year === undefined ? {} : { year: album.year }),
    ...(album.genre === undefined
      ? {}
      : { genre: normalizeGenre(album.genre) }),
    ...(addedAt === undefined ? {} : { addedAt }),
    ...(starredAt === undefined ? {} : { starredAt }),
    ...(playedAt === undefined ? {} : { playedAt }),
    ...(originalReleaseDate === undefined
      ? {}
      : {
          originalReleaseDate: {
            year: originalReleaseDate.year,
            ...(originalReleaseDate.month === undefined
              ? {}
              : { month: originalReleaseDate.month }),
            ...(originalReleaseDate.day === undefined
              ? {}
              : { day: originalReleaseDate.day }),
          },
        }),
    ...(releaseDate === undefined
      ? {}
      : {
          releaseDate: {
            year: releaseDate.year,
            ...(releaseDate.month === undefined
              ? {}
              : { month: releaseDate.month }),
            ...(releaseDate.day === undefined
              ? {}
              : { day: releaseDate.day }),
          },
        }),
    palette: [album.palette[0], album.palette[1]],
  };
}

export function readLibraryCache(now = Date.now()): Album[] {
  try {
    const raw = window.localStorage.getItem(LIBRARY_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<LibraryCache>;
    if (
      typeof parsed.savedAt !== "number" ||
      now - parsed.savedAt > LIBRARY_CACHE_TTL_MS ||
      !Array.isArray(parsed.albums)
    ) {
      window.localStorage.removeItem(LIBRARY_CACHE_KEY);
      return [];
    }
    return parsed.albums
      .filter(isCachedAlbum)
      .slice(0, MAX_CACHED_ALBUMS)
      .map((album) =>
        stripAlbumForCache({
          ...album,
          genre: normalizeGenre(album.genre),
        }),
      );
  } catch {
    return [];
  }
}

export function clearRuntimeCaches(): void {
  clearCoverArtRendererState();
  streamUrlCache.clear();
  try {
    window.localStorage.removeItem(LIBRARY_CACHE_KEY);
  } catch {
    // Storage can be disabled without affecting the live connection.
  }
}

export function invalidateStreamUrl(trackId: string): void {
  streamUrlCache.delete(trackId);
}

export async function hasConnection(): Promise<boolean> {
  if (!isDesktop()) return false;
  return invoke<boolean>("has_connection");
}

export async function loadLibraryCache(): Promise<LibraryCacheSnapshot | undefined> {
  if (!isDesktop()) {
    const albums = readLibraryCache();
    const savedAt = Date.now();
    return albums.length
      ? { savedAt, lastFullSyncAt: savedAt, albums }
      : undefined;
  }
  try {
    window.localStorage.removeItem(LIBRARY_CACHE_KEY);
  } catch {
    // Legacy storage may be unavailable; native hydration is unaffected.
  }
  const snapshot = await invoke<
    | {
        version: number;
        savedAt: number;
        lastFullSyncAt: number;
        albums: Omit<Album, "palette">[];
      }
    | null
  >("load_library_cache");
  if (!snapshot) return undefined;
  return {
    savedAt: snapshot.savedAt,
    lastFullSyncAt: snapshot.lastFullSyncAt,
    albums: snapshot.albums.map(hydrateAlbum),
  };
}

export async function connectBandcamp(
  input: ConnectionInput,
  onPage?: (progress: LibrarySyncProgress) => void,
): Promise<Album[]> {
  const onProgress = new Channel<NativeLibrarySyncEvent>((event) => {
    if (event.kind !== "page") return;
    onPage?.({
      pageIndex: event.pageIndex,
      loaded: event.loaded,
      albums: event.albums.map(hydrateAlbum),
    });
  });
  const albums = await invoke<Omit<Album, "palette">[]>("connect", {
    input,
    onProgress,
  });
  clearCoverArtRendererState();
  streamUrlCache.clear();
  return albums.map(hydrateAlbum);
}

export async function disconnect(): Promise<string | undefined> {
  return (await invoke<string | null>("disconnect")) ?? undefined;
}

export async function loadPlayerState(): Promise<PlayerStateSnapshot | undefined> {
  if (!isDesktop()) return undefined;
  let value: unknown | null;
  try {
    value = await invoke<unknown | null>("load_player_state");
  } catch (cause) {
    void invoke("record_player_state_diagnostic", {
      event: "renderer.load.native-error",
    }).catch(() => undefined);
    throw cause;
  }
  if (value === null) {
    void invoke("record_player_state_diagnostic", {
      event: "renderer.load.none",
    }).catch(() => undefined);
    return undefined;
  }
  const state = await parsePlayerStateAsync(value);
  if (!state) {
    void invoke("record_player_state_diagnostic", {
      event: "renderer.load.invalid",
    }).catch(() => undefined);
    throw new Error("Coda ignored an invalid saved player state.");
  }
  void invoke("record_player_state_diagnostic", {
    event: "renderer.load.ok",
  }).catch(() => undefined);
  return state;
}

export type PlaybackDiagnosticEvent =
  | "renderer.play.request"
  | "renderer.stream.request"
  | "renderer.stream.ready"
  | "renderer.stream.error"
  | "renderer.audio.play-request"
  | "renderer.audio.play-ready"
  | "renderer.audio.play-error"
  | "renderer.audio.media-error";

export function recordPlaybackDiagnostic(event: PlaybackDiagnosticEvent): void {
  if (!isDesktop()) return;
  void invoke("record_player_state_diagnostic", { event }).catch(() => undefined);
}

export async function savePlayerState(input: PlayerStateInput): Promise<void> {
  const [state, contractVersion] = await Promise.all([
    preparePlayerStateSnapshot(input),
    nativePlayerStateContractVersion(),
  ]);
  await waitForPlayerStateIdle();
  return invoke("save_player_state", {
    state: forNativePlayerStateContract(state, contractVersion),
  });
}

export async function checkpointPlayerState(
  checkpoint: PlayerStateCheckpoint,
): Promise<boolean> {
  const [validated, contractVersion] = await Promise.all([
    Promise.resolve(createPlayerStateCheckpoint(checkpoint)),
    nativePlayerStateContractVersion(),
  ]);
  return invoke<boolean>("checkpoint_player_state", {
    checkpoint: forNativePlayerStateContract(validated, contractVersion),
  });
}

export async function clearPlayerState(): Promise<void> {
  return invoke("clear_player_state");
}

export async function getLastFmStatus(): Promise<LastFmStatus> {
  if (!isDesktop()) {
    return { configured: false, connected: false };
  }
  return invoke<LastFmStatus>("lastfm_status");
}

export async function beginLastFmAuthorization(): Promise<LastFmAuthorization> {
  return invoke<LastFmAuthorization>("lastfm_begin_auth");
}

export async function completeLastFmAuthorization(token: string): Promise<LastFmStatus> {
  return invoke<LastFmStatus>("lastfm_complete_auth", { token });
}

export async function disconnectLastFm(): Promise<LastFmStatus> {
  return invoke<LastFmStatus>("lastfm_disconnect");
}

export async function updateLastFmNowPlaying(track: LastFmTrackInput): Promise<void> {
  return invoke("lastfm_update_now_playing", { input: track });
}

export async function scrobbleLastFm(track: LastFmTrackInput, timestamp: number): Promise<void> {
  return invoke("lastfm_scrobble", { input: { track, timestamp } });
}

export async function openLastFmAuthorization(value: string): Promise<void> {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "www.last.fm" ||
    url.pathname !== "/api/auth/"
  ) {
    throw new Error("Coda only opens the verified Last.fm authorization page.");
  }
  if (isDesktop()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url.toString());
  } else {
    window.open(url.toString(), "_blank", "noopener,noreferrer");
  }
}

export async function fetchLibrary(
  onPage?: (progress: LibrarySyncProgress) => void,
  options: { forceFull?: boolean } = {},
): Promise<Album[]> {
  const onProgress = new Channel<NativeLibrarySyncEvent>((event) => {
    if (event.kind !== "page") return;
    onPage?.({
      pageIndex: event.pageIndex,
      loaded: event.loaded,
      albums: event.albums.map(hydrateAlbum),
    });
  });
  const albums = await invoke<Omit<Album, "palette">[]>("fetch_library", {
    onProgress,
    forceFull: options.forceFull ?? false,
  });
  const hydrated = albums.map(hydrateAlbum);
  return hydrated;
}

export async function fetchAlbum(
  album: Album,
  options: { forceRefresh?: boolean } = {},
): Promise<Track[]> {
  const tracks = await invoke<Omit<Track, "palette">[]>("fetch_album", {
    albumId: album.id,
    forceRefresh: options.forceRefresh ?? false,
  });
  return tracks.map((track) => hydrateTrack(track, album.palette));
}

export async function fetchFavorites(): Promise<FavoriteCollection> {
  const favorites = await invoke<{
    albumIds: string[];
    songIds: string[];
    albums: Omit<Album, "palette">[];
    tracks: Omit<Track, "palette">[];
  }>("fetch_favorites");
  const albums = favorites.albums.map(hydrateAlbum);
  const albumPalettes = new Map(
    albums.map((album) => [album.id, album.palette] as const),
  );
  return {
    ...favorites,
    albums,
    tracks: favorites.tracks.map((track) =>
      hydrateTrack(track, albumPalettes.get(track.albumId))),
  };
}

export async function setFavorite(
  input: FavoriteInput,
): Promise<FavoriteMutationResult> {
  const result = await invoke<
    Omit<FavoriteMutationResult, "track"> & {
      track?: Omit<Track, "palette">;
    }
  >("set_favorite", { input });
  const { track, ...mutation } = result;
  return {
    ...mutation,
    ...(track === undefined
      ? {}
      : { track: hydrateTrack(track) }),
  };
}

export async function reconcileFavoriteTracks(
  tracks: FavoriteTrackLocator[],
): Promise<FavoriteTrackReconciliation> {
  const result = await invoke<
    Omit<FavoriteTrackReconciliation, "tracks"> & {
      tracks: Omit<Track, "palette">[];
    }
  >("reconcile_favorite_tracks", { tracks });
  return {
    ...result,
    tracks: result.tracks.map((track) => hydrateTrack(track)),
  };
}

function hydratePlaylist(
  playlist: Omit<PlaylistDetail, "tracks"> & {
    tracks: Omit<Track, "palette">[];
  },
): PlaylistDetail {
  return {
    ...playlist,
    tracks: playlist.tracks.map((track) => hydrateTrack(track)),
  };
}

export async function fetchPlaylists(): Promise<PlaylistSummary[]> {
  return invoke<PlaylistSummary[]>("fetch_playlists");
}

export async function fetchPlaylist(playlistId: string): Promise<PlaylistDetail> {
  const playlist = await invoke<
    Omit<PlaylistDetail, "tracks"> & { tracks: Omit<Track, "palette">[] }
  >("fetch_playlist", { playlistId });
  return hydratePlaylist(playlist);
}

export async function createPlaylist(
  name: string,
  songIds: string[] = [],
): Promise<PlaylistDetail> {
  const playlist = await invoke<
    Omit<PlaylistDetail, "tracks"> & { tracks: Omit<Track, "palette">[] }
  >("create_playlist", { name, songIds });
  return hydratePlaylist(playlist);
}

export async function updatePlaylist(
  input: PlaylistUpdateInput,
): Promise<PlaylistDetail | undefined> {
  const playlist = await invoke<
    | (Omit<PlaylistDetail, "tracks"> & { tracks: Omit<Track, "palette">[] })
    | null
  >("update_playlist", {
    input: {
      ...input,
      songIdsToAdd: input.songIdsToAdd ?? [],
      songIndexesToRemove: input.songIndexesToRemove ?? [],
    },
  });
  return playlist ? hydratePlaylist(playlist) : undefined;
}

export async function deletePlaylist(playlistId: string): Promise<void> {
  return invoke("delete_playlist", { playlistId });
}

export async function fetchStreamUrl(trackId: string): Promise<string> {
  return rememberPromise(
    streamUrlCache,
    trackId,
    () => invoke<string>("get_stream_url", { trackId }),
    MAX_MEDIA_URLS,
    STREAM_URL_CACHE_TTL_MS,
  );
}

export async function coverCacheDiagnostics(): Promise<CoverCacheDiagnostics> {
  return invoke<CoverCacheDiagnostics>("cover_cache_diagnostics");
}

export async function fetchDiscover(
  filters: DiscoverFilters,
  cursor = "*",
): Promise<DiscoverPage> {
  if (!isDesktop()) {
    throw new Error("Discover is available in the Coda desktop app.");
  }
  return invoke<DiscoverPage>("discover", {
    input: {
      tag: filters.tag,
      sort: filters.sort,
      cursor,
    },
  });
}

export async function fetchDailyArticles(
  section: DailyCategory,
  page = 1,
): Promise<DailyArticlesPage> {
  if (!isDesktop()) {
    throw new Error("Bandcamp Daily is available in the Coda desktop app.");
  }
  return invoke<DailyArticlesPage>("daily_articles", { page, section });
}

export async function fetchDailyArticle(
  articleSection: string,
  slug: string,
): Promise<DailyArticle> {
  if (!isDesktop()) {
    throw new Error("Bandcamp Daily is available in the Coda desktop app.");
  }
  return invoke<DailyArticle>("daily_article", { articleSection, slug });
}

export async function fetchRadioShows({
  seriesId,
  cursor,
}: {
  seriesId?: number;
  cursor?: string;
} = {}): Promise<RadioShowsPage> {
  if (!isDesktop()) {
    throw new Error("Bandcamp Radio is available in the Coda desktop app.");
  }
  return invoke<RadioShowsPage>("radio_shows", { seriesId, cursor });
}

export async function fetchRadioShow(showId: number): Promise<RadioShow> {
  if (!isDesktop()) {
    throw new Error("Bandcamp Radio is available in the Coda desktop app.");
  }
  return invoke<RadioShow>("radio_show", { showId });
}

export async function updateSystemMediaMetadata(
  input?: SystemMediaMetadataInput,
): Promise<void> {
  if (!isWindowsDesktop()) return;
  return invoke("update_system_media_metadata", { input });
}

export async function updateSystemMediaPlayback(playing: boolean): Promise<void> {
  if (!isWindowsDesktop()) return;
  return invoke("update_system_media_playback", { playing });
}

export async function updateSystemMediaTimeline(
  positionSeconds: number,
  durationSeconds: number,
): Promise<void> {
  if (!isWindowsDesktop()) return;
  return invoke("update_system_media_timeline", {
    positionSeconds,
    durationSeconds,
  });
}

export async function openBandcampUrl(value: string): Promise<void> {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    (host !== "bandcamp.com" && !host.endsWith(".bandcamp.com"))
  ) {
    throw new Error("Coda only opens verified Bandcamp links.");
  }
  if (isDesktop()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url.toString());
  } else {
    window.open(url.toString(), "_blank", "noopener,noreferrer");
  }
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const rounded = Math.floor(seconds);
  const hours = Math.floor(rounded / 3_600);
  const minutes = Math.floor((rounded % 3_600) / 60);
  const tail = `${String(minutes).padStart(hours ? 2 : 1, "0")}:${String(rounded % 60).padStart(2, "0")}`;
  return hours ? `${hours}:${tail}` : tail;
}

export function initials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}
