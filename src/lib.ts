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
  ItemDate,
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

type LibraryCacheWireRecord = {
  [field: string]: LibraryCacheWireValue;
};

type LibraryCacheWireValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | LibraryCacheWireValue[]
  | LibraryCacheWireRecord;

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
    { kind: "cover"; coverArtId: string } | { kind: "remote"; url: string };
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

type NativeAlbum = Omit<Album, "palette">;
type NativeTrack = Omit<Track, "palette">;
type NativeFavoriteCollection = {
  albumIds: string[];
  songIds: string[];
  albums: NativeAlbum[];
  tracks: NativeTrack[];
};
type NativeFavoriteMutationResult = Omit<FavoriteMutationResult, "track"> & {
  track?: NativeTrack;
};
type NativeFavoriteTrackReconciliation = Omit<
  FavoriteTrackReconciliation,
  "tracks"
> & {
  tracks: NativeTrack[];
};
type NativePlaylistDetail = Omit<PlaylistDetail, "tracks"> & {
  tracks: NativeTrack[];
};

export type NativeChannelFactory = <Event>(
  onmessage: (event: Event) => void,
) => {
  onmessage: (event: Event) => void;
};

const createTauriChannel: NativeChannelFactory = <Event>(
  onmessage: (event: Event) => void,
) => new Channel<Event>(onmessage);

export function createCodaDataBridge(
  nativeInvoke: typeof invoke = invoke,
  createChannel: NativeChannelFactory = createTauriChannel,
) {
  return Object.freeze({
    fetchLibrary(
      forceFull: boolean,
      onProgress: (event: NativeLibrarySyncEvent) => void,
    ): Promise<NativeAlbum[]> {
      return nativeInvoke<NativeAlbum[]>("fetch_library", {
        onProgress: createChannel(onProgress),
        forceFull,
      });
    },
    fetchAlbum(albumId: string, forceRefresh: boolean): Promise<NativeTrack[]> {
      return nativeInvoke<NativeTrack[]>("fetch_album", {
        albumId,
        forceRefresh,
      });
    },
    fetchFavorites(): Promise<NativeFavoriteCollection> {
      return nativeInvoke<NativeFavoriteCollection>("fetch_favorites");
    },
    setFavorite(input: FavoriteInput): Promise<NativeFavoriteMutationResult> {
      return nativeInvoke<NativeFavoriteMutationResult>("set_favorite", {
        input,
      });
    },
    reconcileFavoriteTracks(
      tracks: FavoriteTrackLocator[],
    ): Promise<NativeFavoriteTrackReconciliation> {
      return nativeInvoke<NativeFavoriteTrackReconciliation>(
        "reconcile_favorite_tracks",
        { tracks },
      );
    },
    updatePlaylist(
      input: PlaylistUpdateInput,
    ): Promise<NativePlaylistDetail | null> {
      return nativeInvoke<NativePlaylistDetail | null>("update_playlist", {
        input,
      });
    },
    fetchStreamUrl(trackId: string): Promise<string> {
      return nativeInvoke<string>("get_stream_url", { trackId });
    },
    fetchDailyArticles(
      section: DailyCategory,
      page: number,
    ): Promise<DailyArticlesPage> {
      return nativeInvoke<DailyArticlesPage>("daily_articles", {
        page,
        section,
      });
    },
    fetchDailyArticle(
      articleSection: string,
      slug: string,
    ): Promise<DailyArticle> {
      return nativeInvoke<DailyArticle>("daily_article", {
        articleSection,
        slug,
      });
    },
  });
}

export type CodaDataBridge = ReturnType<typeof createCodaDataBridge>;

const nativeCodaDataBridge = createCodaDataBridge();

type RuntimeCacheEntry<T> = {
  promise: Promise<T>;
  expiresAt: number;
  value?: T;
};

let playerStateContractVersionRequest: Promise<number> | undefined;

async function nativePlayerStateContractVersion(): Promise<number> {
  if (!playerStateContractVersionRequest) {
    playerStateContractVersionRequest = invoke<number>(
      "player_state_contract_version",
    )
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

export function createStreamUrlRepository(
  bridge: Pick<CodaDataBridge, "fetchStreamUrl">,
) {
  const cache = new Map<string, RuntimeCacheEntry<string>>();
  return Object.freeze({
    fetch(trackId: string): Promise<string> {
      return rememberPromise(
        cache,
        trackId,
        () => bridge.fetchStreamUrl(trackId),
        MAX_MEDIA_URLS,
        STREAM_URL_CACHE_TTL_MS,
      );
    },
    invalidate(trackId: string): void {
      cache.delete(trackId);
    },
    clear(): void {
      cache.clear();
    },
  });
}

const nativeStreamUrls = createStreamUrlRepository(nativeCodaDataBridge);

function isLibraryCacheRecord(
  value: LibraryCacheWireValue,
): value is LibraryCacheWireRecord {
  return (
    value !== null &&
    value !== undefined &&
    Object(value) === value &&
    !Array.isArray(value)
  );
}

function isLibraryCacheText(value: LibraryCacheWireValue): value is string {
  return String(value) === value;
}

function isLibraryCacheNumber(value: LibraryCacheWireValue): value is number {
  return Number(value) === value && Number.isFinite(value);
}

function cachedPalette(
  value: LibraryCacheWireValue,
): [string, string] | undefined {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const [first, second] = value;
  if (!isLibraryCacheText(first) || !isLibraryCacheText(second)) {
    return undefined;
  }
  return [first, second];
}

function copyItemDate(value: LibraryCacheWireValue): ItemDate | undefined {
  if (!isItemDate(value)) return undefined;
  const date: ItemDate = { year: value.year };
  if (value.month !== undefined) date.month = value.month;
  if (value.day !== undefined) date.day = value.day;
  return date;
}

function parseCachedAlbum(value: LibraryCacheWireValue): Album | undefined {
  if (!isLibraryCacheRecord(value)) return undefined;
  const palette = cachedPalette(value.palette);
  if (
    !isLibraryCacheText(value.id) ||
    !isLibraryCacheText(value.title) ||
    !isLibraryCacheText(value.artist) ||
    !isLibraryCacheNumber(value.songCount) ||
    !isLibraryCacheNumber(value.duration) ||
    (value.year !== undefined &&
      (!isLibraryCacheNumber(value.year) ||
        !Number.isInteger(value.year) ||
        value.year <= 0 ||
        value.year > 9_999)) ||
    !palette
  ) {
    return undefined;
  }

  const album: Album = {
    id: value.id,
    title: value.title,
    artist: value.artist,
    songCount: value.songCount,
    duration: value.duration,
    palette,
  };
  if (isLibraryCacheText(value.coverArt)) album.coverArt = value.coverArt;
  if (isLibraryCacheNumber(value.year)) album.year = value.year;
  if (isLibraryCacheText(value.genre)) {
    album.genre = normalizeGenre(value.genre);
  }
  if (isLibraryCacheText(value.addedAt)) album.addedAt = value.addedAt;
  if (isLibraryCacheText(value.starredAt)) album.starredAt = value.starredAt;
  if (isLibraryCacheText(value.playedAt)) album.playedAt = value.playedAt;
  const originalReleaseDate = copyItemDate(value.originalReleaseDate);
  if (originalReleaseDate !== undefined) {
    album.originalReleaseDate = originalReleaseDate;
  }
  const releaseDate = copyItemDate(value.releaseDate);
  if (releaseDate !== undefined) album.releaseDate = releaseDate;
  return album;
}

export function readLibraryCache(now = Date.now()): Album[] {
  try {
    const raw = window.localStorage.getItem(LIBRARY_CACHE_KEY);
    if (!raw) return [];
    const parsed: LibraryCacheWireValue = JSON.parse(raw);
    if (
      !isLibraryCacheRecord(parsed) ||
      !isLibraryCacheNumber(parsed.savedAt) ||
      now - parsed.savedAt > LIBRARY_CACHE_TTL_MS ||
      !Array.isArray(parsed.albums)
    ) {
      window.localStorage.removeItem(LIBRARY_CACHE_KEY);
      return [];
    }
    const albums: Album[] = [];
    for (const value of parsed.albums.slice(0, MAX_CACHED_ALBUMS)) {
      const album = parseCachedAlbum(value);
      if (album) albums.push(album);
    }
    return albums;
  } catch {
    return [];
  }
}

export function clearRuntimeCaches(): void {
  clearCoverArtRendererState();
  nativeStreamUrls.clear();
  try {
    window.localStorage.removeItem(LIBRARY_CACHE_KEY);
  } catch {
    // Storage can be disabled without affecting the live connection.
  }
}

export function invalidateStreamUrl(trackId: string): void {
  nativeStreamUrls.invalidate(trackId);
}

export async function hasConnection(): Promise<boolean> {
  if (!isDesktop()) return false;
  return invoke<boolean>("has_connection");
}

export async function loadLibraryCache(): Promise<
  LibraryCacheSnapshot | undefined
> {
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
  const snapshot = await invoke<{
    version: number;
    savedAt: number;
    lastFullSyncAt: number;
    albums: Omit<Album, "palette">[];
  } | null>("load_library_cache");
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
  nativeStreamUrls.clear();
  return albums.map(hydrateAlbum);
}

export async function disconnect(): Promise<string | undefined> {
  return (await invoke<string | null>("disconnect")) ?? undefined;
}

export async function loadPlayerState(): Promise<
  PlayerStateSnapshot | undefined
> {
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
  void invoke("record_player_state_diagnostic", { event }).catch(
    () => undefined,
  );
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

export async function completeLastFmAuthorization(
  token: string,
): Promise<LastFmStatus> {
  return invoke<LastFmStatus>("lastfm_complete_auth", { token });
}

export async function disconnectLastFm(): Promise<LastFmStatus> {
  return invoke<LastFmStatus>("lastfm_disconnect");
}

export async function updateLastFmNowPlaying(
  track: LastFmTrackInput,
): Promise<void> {
  return invoke("lastfm_update_now_playing", { input: track });
}

export async function scrobbleLastFm(
  track: LastFmTrackInput,
  timestamp: number,
): Promise<void> {
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
  bridge: CodaDataBridge = nativeCodaDataBridge,
): Promise<Album[]> {
  const albums = await bridge.fetchLibrary(
    options.forceFull ?? false,
    (event) => {
      if (event.kind !== "page") return;
      onPage?.({
        pageIndex: event.pageIndex,
        loaded: event.loaded,
        albums: event.albums.map(hydrateAlbum),
      });
    },
  );
  const hydrated = albums.map(hydrateAlbum);
  return hydrated;
}

export async function fetchAlbum(
  album: Album,
  options: { forceRefresh?: boolean } = {},
  bridge: CodaDataBridge = nativeCodaDataBridge,
): Promise<Track[]> {
  const tracks = await bridge.fetchAlbum(
    album.id,
    options.forceRefresh ?? false,
  );
  return tracks.map((track) => hydrateTrack(track, album.palette));
}

export async function fetchFavorites(
  bridge: CodaDataBridge = nativeCodaDataBridge,
): Promise<FavoriteCollection> {
  const favorites = await bridge.fetchFavorites();
  const albums = favorites.albums.map(hydrateAlbum);
  const albumPalettes = new Map(
    albums.map((album) => [album.id, album.palette] as const),
  );
  return {
    ...favorites,
    albums,
    tracks: favorites.tracks.map((track) =>
      hydrateTrack(track, albumPalettes.get(track.albumId)),
    ),
  };
}

export async function setFavorite(
  input: FavoriteInput,
  bridge: CodaDataBridge = nativeCodaDataBridge,
): Promise<FavoriteMutationResult> {
  const result = await bridge.setFavorite(input);
  const { track, ...mutation } = result;
  const hydrated: FavoriteMutationResult = { ...mutation };
  if (track !== undefined) hydrated.track = hydrateTrack(track);
  return hydrated;
}

export async function reconcileFavoriteTracks(
  tracks: FavoriteTrackLocator[],
  bridge: CodaDataBridge = nativeCodaDataBridge,
): Promise<FavoriteTrackReconciliation> {
  const result = await bridge.reconcileFavoriteTracks(tracks);
  return {
    ...result,
    tracks: result.tracks.map((track) => hydrateTrack(track)),
  };
}

function hydratePlaylist(playlist: NativePlaylistDetail): PlaylistDetail {
  return {
    ...playlist,
    tracks: playlist.tracks.map((track) => hydrateTrack(track)),
  };
}

export async function fetchPlaylists(): Promise<PlaylistSummary[]> {
  return invoke<PlaylistSummary[]>("fetch_playlists");
}

export async function fetchPlaylist(
  playlistId: string,
): Promise<PlaylistDetail> {
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

export function updatePlaylist(
  input: PlaylistUpdateInput,
): Promise<PlaylistDetail | undefined>;
export function updatePlaylist(
  input: PlaylistUpdateInput,
  bridge: CodaDataBridge,
): Promise<PlaylistDetail | undefined>;
export async function updatePlaylist(
  input: PlaylistUpdateInput,
  bridge: CodaDataBridge = nativeCodaDataBridge,
): Promise<PlaylistDetail | undefined> {
  const playlist = await bridge.updatePlaylist({
    ...input,
    songIdsToAdd: input.songIdsToAdd ?? [],
    songIndexesToRemove: input.songIndexesToRemove ?? [],
  });
  return playlist ? hydratePlaylist(playlist) : undefined;
}

export async function deletePlaylist(playlistId: string): Promise<void> {
  return invoke("delete_playlist", { playlistId });
}

export async function fetchStreamUrl(
  trackId: string,
  bridge?: CodaDataBridge,
): Promise<string> {
  if (bridge) return bridge.fetchStreamUrl(trackId);
  return nativeStreamUrls.fetch(trackId);
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
  bridge: CodaDataBridge = nativeCodaDataBridge,
): Promise<DailyArticlesPage> {
  if (!isDesktop()) {
    throw new Error("Bandcamp Daily is available in the Coda desktop app.");
  }
  return bridge.fetchDailyArticles(section, page);
}

export async function fetchDailyArticle(
  articleSection: string,
  slug: string,
  bridge: CodaDataBridge = nativeCodaDataBridge,
): Promise<DailyArticle> {
  if (!isDesktop()) {
    throw new Error("Bandcamp Daily is available in the Coda desktop app.");
  }
  return bridge.fetchDailyArticle(articleSection, slug);
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

export async function updateSystemMediaPlayback(
  playing: boolean,
): Promise<void> {
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
