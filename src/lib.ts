import { invoke } from "@tauri-apps/api/core";
import { normalizeGenre } from "./genres";
import type {
  Album,
  ConnectionInput,
  DiscoverFilters,
  DiscoverPage,
  Track,
} from "./types";

export const isDesktop = () => "__TAURI_INTERNALS__" in window;

const LIBRARY_CACHE_KEY = "coda.library.v1";
const LIBRARY_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CACHED_ALBUMS = 5_000;
const MAX_MEDIA_URLS = 512;
const MAX_ALBUM_REQUESTS = 128;

type LibraryCache = {
  savedAt: number;
  albums: Album[];
};

const coverUrlCache = new Map<string, Promise<string>>();
const streamUrlCache = new Map<string, Promise<string>>();
const albumRequestCache = new Map<string, Promise<Track[]>>();

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
  cache: Map<string, Promise<T>>,
  key: string,
  load: () => Promise<T>,
  limit: number,
): Promise<T> {
  const existing = cache.get(key);
  if (existing) {
    cache.delete(key);
    cache.set(key, existing);
    return existing;
  }

  const request = load().catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, request);
  if (cache.size > limit) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  return request;
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
    Array.isArray(album.palette) &&
    album.palette.length === 2 &&
    album.palette.every((color) => typeof color === "string")
  );
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
      .map((album) => ({ ...album, genre: normalizeGenre(album.genre) }));
  } catch {
    return [];
  }
}

export function writeLibraryCache(albums: Album[]): void {
  const payload: LibraryCache = {
    savedAt: Date.now(),
    albums: albums.slice(0, MAX_CACHED_ALBUMS).map(({ tracks: _tracks, ...album }) => album),
  };
  const write = () => {
    try {
      window.localStorage.setItem(LIBRARY_CACHE_KEY, JSON.stringify(payload));
    } catch {
      // A full or unavailable cache must never prevent playback.
    }
  };
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(write, { timeout: 1_500 });
  } else {
    globalThis.setTimeout(write, 0);
  }
}

export function clearRuntimeCaches(): void {
  coverUrlCache.clear();
  streamUrlCache.clear();
  albumRequestCache.clear();
  try {
    window.localStorage.removeItem(LIBRARY_CACHE_KEY);
  } catch {
    // Storage can be disabled without affecting the live connection.
  }
}

export function invalidateCoverUrl(coverArtId: string): void {
  coverUrlCache.delete(coverArtId);
}

export function clearCoverUrlCache(): void {
  coverUrlCache.clear();
}

export async function hasConnection(): Promise<boolean> {
  if (!isDesktop()) return false;
  return invoke<boolean>("has_connection");
}

export async function connectBandcamp(input: ConnectionInput): Promise<Album[]> {
  const albums = await invoke<Omit<Album, "palette">[]>("connect", { input });
  const hydrated = albums.map(hydrateAlbum);
  writeLibraryCache(hydrated);
  return hydrated;
}

export async function disconnect(): Promise<void> {
  return invoke("disconnect");
}

export async function fetchLibrary(): Promise<Album[]> {
  const albums = await invoke<Omit<Album, "palette">[]>("fetch_library");
  const hydrated = albums.map(hydrateAlbum);
  writeLibraryCache(hydrated);
  return hydrated;
}

export async function fetchAlbum(album: Album): Promise<Track[]> {
  return rememberPromise(
    albumRequestCache,
    album.id,
    async () => {
      const tracks = await invoke<Omit<Track, "palette">[]>("fetch_album", {
        albumId: album.id,
      });
      return tracks.map((track) => hydrateTrack(track, album.palette));
    },
    MAX_ALBUM_REQUESTS,
  );
}

export async function fetchStreamUrl(trackId: string): Promise<string> {
  return rememberPromise(
    streamUrlCache,
    trackId,
    () => invoke<string>("get_stream_url", { trackId }),
    MAX_MEDIA_URLS,
  );
}

export async function fetchCoverUrl(coverArtId: string): Promise<string> {
  return rememberPromise(
    coverUrlCache,
    coverArtId,
    () => invoke<string>("get_cover_url", { coverArtId }),
    MAX_MEDIA_URLS,
  );
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
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

export function initials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}
