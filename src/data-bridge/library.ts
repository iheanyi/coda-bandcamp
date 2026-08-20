import type { Album, ConnectionInput, ItemDate, Track } from "../types";
import { isDesktop } from "./desktop";
import { hydrateAlbum, hydrateTrack } from "./hydration";
import {
  clearStoredLibraryCache,
  parseNativeLibraryCachePayload,
  readLibraryCache,
} from "./libraryCache";
import {
  decodeNativeArray,
  decodeNativeBoolean,
  decodeNativeInteger,
  decodeNativeOptionalInteger,
  decodeNativeOptionalString,
  decodeNativeRecord,
  decodeNativeString,
  invokeNative,
  invalidNativeResponse,
  MAX_NATIVE_IDENTIFIER_BYTES,
  MAX_NATIVE_METADATA_BYTES,
  nativeChannel,
  type NativeValue,
} from "./native";

const MAX_LIBRARY_ALBUMS = 5_000;
const MAX_ALBUM_TRACKS = 25_000;
const MAX_ALBUM_DURATION_SECONDS = 10 * 365 * 24 * 60 * 60;
const MAX_TRACK_DURATION_SECONDS = 7 * 24 * 60 * 60;
const MAX_TRACK_NUMBER = 100_000;

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

export type NativeLibrarySyncEvent = {
  kind: "page";
  pageIndex: number;
  loaded: number;
  albums: NativeAlbum[];
};

export type NativeAlbum = Omit<
  Album,
  "artworkUrl" | "palette" | "tracks"
>;
export type NativeTrack = Omit<
  Track,
  | "artworkUrl"
  | "dailySource"
  | "discoverRelease"
  | "palette"
  | "radioChapters"
  | "streamUrl"
>;

function decodeNativeItemDate(
  value: NativeValue,
  context: string,
): ItemDate | undefined {
  if (value === null || value === undefined) return undefined;
  const record = decodeNativeRecord(value, context);
  const year = decodeNativeInteger(record.year, `${context}.year`, 9_999, 1);
  const month = decodeNativeOptionalInteger(
    record.month,
    `${context}.month`,
    12,
    1,
  );
  const day = decodeNativeOptionalInteger(record.day, `${context}.day`, 31, 1);
  if (day !== undefined && month === undefined) {
    return invalidNativeResponse(context, "a calendar date");
  }
  if (month !== undefined && day !== undefined) {
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    date.setUTCHours(0, 0, 0, 0);
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return invalidNativeResponse(context, "a calendar date");
    }
  }
  const parsed: ItemDate = { year };
  if (month !== undefined) parsed.month = month;
  if (day !== undefined) parsed.day = day;
  return parsed;
}

export function parseNativeAlbum(
  value: NativeValue,
  context = "album",
): NativeAlbum {
  const record = decodeNativeRecord(value, context);
  const album: NativeAlbum = {
    id: decodeNativeString(
      record.id,
      `${context}.id`,
      MAX_NATIVE_IDENTIFIER_BYTES,
    ),
    title: decodeNativeString(
      record.title,
      `${context}.title`,
      MAX_NATIVE_METADATA_BYTES,
    ),
    artist: decodeNativeString(
      record.artist,
      `${context}.artist`,
      MAX_NATIVE_METADATA_BYTES,
    ),
    songCount: decodeNativeInteger(
      record.songCount,
      `${context}.songCount`,
      MAX_ALBUM_TRACKS,
    ),
    duration: decodeNativeInteger(
      record.duration,
      `${context}.duration`,
      MAX_ALBUM_DURATION_SECONDS,
    ),
  };
  const coverArt = decodeNativeOptionalString(
    record.coverArt,
    `${context}.coverArt`,
    MAX_NATIVE_IDENTIFIER_BYTES,
  );
  const year = decodeNativeOptionalInteger(
    record.year,
    `${context}.year`,
    9_999,
    1,
  );
  const genre = decodeNativeOptionalString(
    record.genre,
    `${context}.genre`,
    MAX_NATIVE_METADATA_BYTES,
  );
  const addedAt = decodeNativeOptionalString(
    record.addedAt,
    `${context}.addedAt`,
    MAX_NATIVE_METADATA_BYTES,
    true,
  );
  const starredAt = decodeNativeOptionalString(
    record.starredAt,
    `${context}.starredAt`,
    MAX_NATIVE_METADATA_BYTES,
    true,
  );
  const playedAt = decodeNativeOptionalString(
    record.playedAt,
    `${context}.playedAt`,
    MAX_NATIVE_METADATA_BYTES,
    true,
  );
  const originalReleaseDate = decodeNativeItemDate(
    record.originalReleaseDate,
    `${context}.originalReleaseDate`,
  );
  const releaseDate = decodeNativeItemDate(
    record.releaseDate,
    `${context}.releaseDate`,
  );
  if (coverArt !== undefined) album.coverArt = coverArt;
  if (year !== undefined) album.year = year;
  if (genre !== undefined) album.genre = genre;
  if (addedAt !== undefined) album.addedAt = addedAt;
  if (starredAt !== undefined) album.starredAt = starredAt;
  if (playedAt !== undefined) album.playedAt = playedAt;
  if (originalReleaseDate !== undefined) {
    album.originalReleaseDate = originalReleaseDate;
  }
  if (releaseDate !== undefined) album.releaseDate = releaseDate;
  return album;
}

export function parseNativeTrack(
  value: NativeValue,
  context = "track",
): NativeTrack {
  const record = decodeNativeRecord(value, context);
  const track: NativeTrack = {
    id: decodeNativeString(
      record.id,
      `${context}.id`,
      MAX_NATIVE_IDENTIFIER_BYTES,
    ),
    title: decodeNativeString(
      record.title,
      `${context}.title`,
      MAX_NATIVE_METADATA_BYTES,
    ),
    artist: decodeNativeString(
      record.artist,
      `${context}.artist`,
      MAX_NATIVE_METADATA_BYTES,
    ),
    album: decodeNativeString(
      record.album,
      `${context}.album`,
      MAX_NATIVE_METADATA_BYTES,
      false,
    ),
    albumId: decodeNativeString(
      record.albumId,
      `${context}.albumId`,
      MAX_NATIVE_IDENTIFIER_BYTES,
    ),
    duration: decodeNativeInteger(
      record.duration,
      `${context}.duration`,
      MAX_TRACK_DURATION_SECONDS,
    ),
    track: decodeNativeInteger(
      record.track,
      `${context}.track`,
      MAX_TRACK_NUMBER,
    ),
  };
  const disc = decodeNativeOptionalInteger(
    record.disc,
    `${context}.disc`,
    MAX_TRACK_NUMBER,
  );
  const albumArtist = decodeNativeOptionalString(
    record.albumArtist,
    `${context}.albumArtist`,
    MAX_NATIVE_METADATA_BYTES,
  );
  const musicBrainzId = decodeNativeOptionalString(
    record.musicBrainzId,
    `${context}.musicBrainzId`,
    36,
    true,
  );
  const coverArt = decodeNativeOptionalString(
    record.coverArt,
    `${context}.coverArt`,
    MAX_NATIVE_IDENTIFIER_BYTES,
  );
  const starredAt = decodeNativeOptionalString(
    record.starredAt,
    `${context}.starredAt`,
    MAX_NATIVE_METADATA_BYTES,
    true,
  );
  if (disc !== undefined) track.disc = disc;
  if (albumArtist !== undefined) track.albumArtist = albumArtist;
  if (musicBrainzId !== undefined) track.musicBrainzId = musicBrainzId;
  if (coverArt !== undefined) track.coverArt = coverArt;
  if (starredAt !== undefined) track.starredAt = starredAt;
  return track;
}

export function parseNativeAlbumList(
  value: NativeValue,
  context = "library albums",
): NativeAlbum[] {
  return decodeNativeArray(
    value,
    context,
    MAX_LIBRARY_ALBUMS,
    parseNativeAlbum,
  );
}

export function parseNativeTrackList(
  value: NativeValue,
  context = "album tracks",
): NativeTrack[] {
  return decodeNativeArray(
    value,
    context,
    MAX_ALBUM_TRACKS,
    parseNativeTrack,
  );
}

export function parseNativeLibrarySyncEvent(
  value: NativeValue,
  context = "library progress",
): NativeLibrarySyncEvent {
  const record = decodeNativeRecord(value, context);
  const kind = decodeNativeString(record.kind, `${context}.kind`, 16);
  if (kind !== "page") {
    return invalidNativeResponse(`${context}.kind`, '"page"');
  }
  return {
    kind,
    pageIndex: decodeNativeInteger(
      record.pageIndex,
      `${context}.pageIndex`,
    ),
    loaded: decodeNativeInteger(
      record.loaded,
      `${context}.loaded`,
      MAX_LIBRARY_ALBUMS,
    ),
    albums: parseNativeAlbumList(record.albums, `${context}.albums`),
  };
}

function reportLibraryProgress(
  event: NativeLibrarySyncEvent,
  onPage?: (progress: LibrarySyncProgress) => void,
): void {
  if (event.kind !== "page") return;
  onPage?.({
    pageIndex: event.pageIndex,
    loaded: event.loaded,
    albums: event.albums.map(hydrateAlbum),
  });
}

async function invokeLibrarySync(
  command: "connect" | "fetch_library",
  args: { input: ConnectionInput } | { forceFull: boolean },
  progressContext: string,
  onPage?: (progress: LibrarySyncProgress) => void,
): Promise<Album[]> {
  const onProgress = nativeChannel((event) =>
    reportLibraryProgress(
      parseNativeLibrarySyncEvent(event, progressContext),
      onPage,
    ),
  );
  const albums = parseNativeAlbumList(
    await invokeNative(command, { ...args, onProgress }),
    command,
  );
  return albums.map(hydrateAlbum);
}

export async function hasConnection(): Promise<boolean> {
  if (!isDesktop()) return false;
  return decodeNativeBoolean(
    await invokeNative("has_connection"),
    "has_connection",
  );
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
  clearStoredLibraryCache();
  const snapshot = parseNativeLibraryCachePayload(
    await invokeNative("load_library_cache"),
  );
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
  return invokeLibrarySync("connect", { input }, "connect progress", onPage);
}

export async function disconnect(): Promise<string | undefined> {
  const value = await invokeNative("disconnect");
  if (value === null) return undefined;
  return decodeNativeString(value, "disconnect", 4_096, false);
}

export async function fetchLibrary(
  onPage?: (progress: LibrarySyncProgress) => void,
  options: { forceFull?: boolean } = {},
): Promise<Album[]> {
  return invokeLibrarySync(
    "fetch_library",
    { forceFull: options.forceFull ?? false },
    "fetch_library progress",
    onPage,
  );
}

export async function fetchAlbum(
  album: Album,
  options: { forceRefresh?: boolean } = {},
): Promise<Track[]> {
  const tracks = parseNativeTrackList(
    await invokeNative("fetch_album", {
      albumId: album.id,
      forceRefresh: options.forceRefresh ?? false,
    }),
    "fetch_album",
  );
  return tracks.map((track) => hydrateTrack(track, album.palette));
}
