import { normalizeGenre } from "../genres";
import { parseLibraryDate } from "../libraryDates";
import {
  copyOwnDataArray,
  hasControlCharacter,
  isAbsent,
  isNumberValue,
  isStringValue,
  projectOwnDataRecord,
  type OwnDataValue,
} from "../ownData";
import type { Album, ItemDate } from "../types";
import type { NativeValue } from "./native";

const LIBRARY_CACHE_KEY = "coda.library.v1";
const LIBRARY_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CACHED_ALBUMS = 5_000;
const MAX_LIBRARY_CACHE_BYTES = 32 * 1024 * 1024;
const MAX_METADATA_TEXT_LENGTH = 1_024;
const MAX_ALBUM_SONGS = 25_000;
const MAX_ALBUM_DURATION_SECONDS = 10 * 365 * 24 * 60 * 60;
const LIBRARY_CACHE_VERSION = 1;

export type CachedLibraryAlbum = Omit<
  Album,
  "artworkUrl" | "palette" | "tracks"
>;

export type ValidatedNativeLibraryCache = {
  version: typeof LIBRARY_CACHE_VERSION;
  savedAt: number;
  lastFullSyncAt: number;
  albums: CachedLibraryAlbum[];
};

function isText(
  value: OwnDataValue,
  required = true,
): value is string {
  return (
    isStringValue(value) &&
    value.length <= MAX_METADATA_TEXT_LENGTH &&
    (!required || value.trim().length > 0) &&
    !hasControlCharacter(value)
  );
}

function isIdentifier(value: OwnDataValue): value is string {
  return isText(value) && value.trim() === value;
}

function isSafeCount(
  value: OwnDataValue,
  maximum: number,
): value is number {
  return (
    isNumberValue(value) &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= maximum
  );
}

function isTimestamp(value: OwnDataValue): value is number {
  return (
    isNumberValue(value) &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function isCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function copyItemDate(value: OwnDataValue): ItemDate | undefined {
  const record = projectOwnDataRecord(value);
  if (record === undefined) return undefined;
  const year = record.year;
  const month = record.month;
  const day = record.day;
  if (
    !isSafeCount(year, 9_999) ||
    year === 0 ||
    (!isAbsent(month) && (!isSafeCount(month, 12) || month === 0)) ||
    (!isAbsent(day) && (!isSafeCount(day, 31) || day === 0)) ||
    (!isAbsent(day) && isAbsent(month))
  ) {
    return undefined;
  }
  const date: ItemDate = { year };
  if (isNumberValue(month)) date.month = month;
  if (isNumberValue(day)) {
    if (!isNumberValue(month) || !isCalendarDate(year, month, day)) {
      return undefined;
    }
    date.day = day;
  }
  return date;
}

function cachedPalette(
  value: OwnDataValue,
): [string, string] | undefined {
  const colors = copyOwnDataArray(value, 2);
  if (colors === undefined || colors.length !== 2) return undefined;
  const [first, second] = colors;
  if (
    !isText(first) ||
    first.length > 64 ||
    !isText(second) ||
    second.length > 64
  ) {
    return undefined;
  }
  return [first, second];
}

function parseCachedAlbumMetadata(
  value: OwnDataValue,
): CachedLibraryAlbum | undefined {
  const record = projectOwnDataRecord(value);
  if (record === undefined) return undefined;
  const id = record.id;
  const title = record.title;
  const artist = record.artist;
  const songCount = record.songCount;
  const duration = record.duration;
  if (
    !isIdentifier(id) ||
    !isText(title) ||
    !isText(artist) ||
    !isSafeCount(songCount, MAX_ALBUM_SONGS) ||
    !isSafeCount(duration, MAX_ALBUM_DURATION_SECONDS)
  ) {
    return undefined;
  }

  const album: CachedLibraryAlbum = {
    id,
    title,
    artist,
    songCount,
    duration,
  };
  const coverArt = record.coverArt;
  const year = record.year;
  const genre = record.genre;
  const addedAt = record.addedAt;
  const starredAt = record.starredAt;
  const playedAt = record.playedAt;
  const originalReleaseDateValue = record.originalReleaseDate;
  const releaseDateValue = record.releaseDate;
  const malformedOptional =
    (!isAbsent(coverArt) && !isIdentifier(coverArt)) ||
    (!isAbsent(year) &&
      (!isSafeCount(year, 9_999) || year === 0)) ||
    (!isAbsent(genre) && !isText(genre, false)) ||
    (!isAbsent(addedAt) &&
      (!isText(addedAt, false) || parseLibraryDate(addedAt) === undefined)) ||
    (!isAbsent(starredAt) &&
      (!isText(starredAt, false) ||
        parseLibraryDate(starredAt) === undefined)) ||
    (!isAbsent(playedAt) &&
      (!isText(playedAt, false) || parseLibraryDate(playedAt) === undefined));
  const originalReleaseDate = isAbsent(originalReleaseDateValue)
    ? undefined
    : copyItemDate(originalReleaseDateValue);
  const releaseDate = isAbsent(releaseDateValue)
    ? undefined
    : copyItemDate(releaseDateValue);
  if (
    malformedOptional ||
    (!isAbsent(originalReleaseDateValue) &&
      originalReleaseDate === undefined) ||
    (!isAbsent(releaseDateValue) && releaseDate === undefined)
  ) {
    return undefined;
  }

  if (isIdentifier(coverArt)) album.coverArt = coverArt;
  if (isSafeCount(year, 9_999) && year > 0) album.year = year;
  if (isText(genre, false)) album.genre = normalizeGenre(genre);
  if (isText(addedAt, false) && parseLibraryDate(addedAt) !== undefined) {
    album.addedAt = addedAt;
  }
  if (isText(starredAt, false) && parseLibraryDate(starredAt) !== undefined) {
    album.starredAt = starredAt;
  }
  if (isText(playedAt, false) && parseLibraryDate(playedAt) !== undefined) {
    album.playedAt = playedAt;
  }
  if (originalReleaseDate) album.originalReleaseDate = originalReleaseDate;
  if (releaseDate) album.releaseDate = releaseDate;
  return album;
}

function parseStoredLibraryAlbum(
  value: OwnDataValue,
): Album | undefined {
  const record = projectOwnDataRecord(value);
  if (record === undefined) return undefined;
  const album = parseCachedAlbumMetadata(record);
  const palette = cachedPalette(record.palette);
  return album && palette ? { ...album, palette } : undefined;
}

function validCacheTimestamp(
  savedAt: OwnDataValue,
  now: number,
): savedAt is number {
  return (
    isTimestamp(savedAt) &&
    savedAt <= now &&
    now - savedAt <= LIBRARY_CACHE_TTL_MS
  );
}

export function parseStoredLibraryCachePayload(
  value: OwnDataValue,
  now = Date.now(),
): Album[] | undefined {
  const record = projectOwnDataRecord(value);
  if (record === undefined) return undefined;
  const version = record.version;
  const savedAt = record.savedAt;
  const lastFullSyncAt = record.lastFullSyncAt;
  const albumValues = copyOwnDataArray(record.albums, MAX_CACHED_ALBUMS);
  if (
    version !== LIBRARY_CACHE_VERSION ||
    !validCacheTimestamp(savedAt, now) ||
    !isTimestamp(lastFullSyncAt) ||
    lastFullSyncAt > savedAt ||
    albumValues === undefined
  ) {
    return undefined;
  }
  const albums: Album[] = [];
  for (let index = 0; index < albumValues.length; index += 1) {
    const album = parseStoredLibraryAlbum(albumValues[index]);
    if (!album) return undefined;
    albums.push(album);
  }
  return albums;
}

export function parseNativeLibraryCachePayload(
  value: NativeValue,
  now = Date.now(),
): ValidatedNativeLibraryCache | undefined {
  const record = projectOwnDataRecord(value);
  if (record === undefined) return undefined;
  const version = record.version;
  const savedAt = record.savedAt;
  const lastFullSyncAt = record.lastFullSyncAt;
  const albumValues = copyOwnDataArray(record.albums, MAX_CACHED_ALBUMS);
  if (
    version !== LIBRARY_CACHE_VERSION ||
    !validCacheTimestamp(savedAt, now) ||
    !isTimestamp(lastFullSyncAt) ||
    lastFullSyncAt > savedAt ||
    albumValues === undefined
  ) {
    return undefined;
  }
  const albums: CachedLibraryAlbum[] = [];
  for (let index = 0; index < albumValues.length; index += 1) {
    const album = parseCachedAlbumMetadata(albumValues[index]);
    if (!album) return undefined;
    albums.push(album);
  }
  return { version: LIBRARY_CACHE_VERSION, savedAt, lastFullSyncAt, albums };
}

function discardStoredLibraryCache(): void {
  try {
    window.localStorage.removeItem(LIBRARY_CACHE_KEY);
  } catch {
    // Storage can be disabled without affecting the live connection.
  }
}

export function readLibraryCache(now = Date.now()): Album[] {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(LIBRARY_CACHE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  if (raw.length > MAX_LIBRARY_CACHE_BYTES) {
    discardStoredLibraryCache();
    return [];
  }
  let parsed: OwnDataValue;
  try {
    parsed = JSON.parse(raw);
  } catch {
    discardStoredLibraryCache();
    return [];
  }
  const albums = parseStoredLibraryCachePayload(parsed, now);
  if (!albums) {
    discardStoredLibraryCache();
    return [];
  }
  return albums;
}

export function clearStoredLibraryCache(): void {
  try {
    window.localStorage.removeItem(LIBRARY_CACHE_KEY);
  } catch {
    // Storage can be disabled without affecting the live connection.
  }
}
