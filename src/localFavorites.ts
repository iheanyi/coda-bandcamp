import type {
  Album,
  FavoriteInput,
  ItemDate,
  LocalFavoriteCollection,
  RadioShowSummary,
  Track,
} from "./types";
import { parseLibraryDate } from "./libraryDates";
import {
  hasControlCharacter,
  INVALID_OWN_DATA_PROPERTY as INVALID_PROPERTY,
  isDataArray,
  isNumberValue,
  isOwnDataRecord,
  isStringValue,
  MISSING_OWN_DATA_PROPERTY as MISSING_PROPERTY,
  ownDataProperty,
  type OwnDataPropertyResult,
  type OwnDataValue,
} from "./ownData";

export const LOCAL_FAVORITES_KEY = "coda.local-favorites.v1";

export const LOCAL_FAVORITES_VERSION = 3;
export const MAX_FAVORITE_ALBUMS = 5_000;
export const MAX_FAVORITE_TRACKS = 25_000;
export const MAX_FAVORITE_RADIO_SHOWS = 5_000;

export function localTrackStarBoundMessage(): string {
  return `Coda can save at most ${MAX_FAVORITE_TRACKS.toLocaleString()} favorite tracks.`;
}

export function localTrackStarIndexCanAccept(
  current: LocalFavoriteCollection,
  trackId: string,
): boolean {
  if (current.songIds.length < MAX_FAVORITE_TRACKS) return true;
  return current.songIds.includes(trackId);
}

const MAX_TRACKS_PER_ALBUM = 5_000;
const MAX_TRACK_NUMBER = 100_000;
export const MAX_LOCAL_FAVORITES_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_LENGTH = 1_024;
const MAX_DURATION_SECONDS = 7 * 24 * 60 * 60;

export type LocalFavoritesSnapshot = LocalFavoriteCollection & {
  version: typeof LOCAL_FAVORITES_VERSION;
};

export function parseLocalFavoritesSerialized(
  serialized: string,
): LocalFavoriteCollection | undefined {
  if (serialized.length > MAX_LOCAL_FAVORITES_BYTES) return undefined;
  try {
    const parsed: OwnDataValue = JSON.parse(serialized);
    return parseLocalFavoritesSnapshot(parsed);
  } catch {
    return undefined;
  }
}

function recordProperty(
  value: OwnDataPropertyResult,
  key: string,
): OwnDataPropertyResult {
  return isOwnDataRecord(value)
    ? ownDataProperty(value, key)
    : INVALID_PROPERTY;
}

function arrayElement(
  values: readonly OwnDataValue[],
  index: number,
): OwnDataPropertyResult {
  return ownDataProperty(values, String(index));
}

// ownData has no bounded-text helper; isStringValue + hasControlCharacter
// omit the 1,024-code-unit cap and required-nonempty policy used here.
function isText(
  value: OwnDataPropertyResult,
  required = true,
): value is string {
  return (
    isStringValue(value) &&
    value.length <= MAX_TEXT_LENGTH &&
    (!required || value.length > 0) &&
    !hasControlCharacter(value)
  );
}

function isCount(
  value: OwnDataPropertyResult,
  maximum = Number.MAX_SAFE_INTEGER,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= maximum
  );
}

function isDuration(value: OwnDataPropertyResult): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_DURATION_SECONDS
  );
}

function isMusicBrainzId(value: OwnDataPropertyResult): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value)
  );
}

// ownData.isAbsent is only null/undefined; ownDataProperty still yields
// MISSING_OWN_DATA_PROPERTY for omitted fields, which must count as absent.
function isAbsent(value: OwnDataPropertyResult): boolean {
  return (
    value === MISSING_PROPERTY ||
    value === undefined ||
    value === null
  );
}

function sanitizeDateText(value: OwnDataPropertyResult): string | undefined {
  return isText(value, false) && parseLibraryDate(value) !== undefined
    ? value
    : undefined;
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

function sanitizeItemDate(value: OwnDataPropertyResult): ItemDate | undefined {
  if (!isOwnDataRecord(value)) return undefined;
  const year = recordProperty(value, "year");
  const month = recordProperty(value, "month");
  const day = recordProperty(value, "day");
  if (
    !isCount(year, 9_999) ||
    year === 0 ||
    (!isAbsent(month) &&
      (!isCount(month, 12) || month === 0)) ||
    (!isAbsent(day) &&
      (!isCount(day, 31) || day === 0)) ||
    (!isAbsent(day) && isAbsent(month))
  ) {
    return undefined;
  }
  const sanitized: ItemDate = { year };
  if (isNumberValue(month)) sanitized.month = month;
  if (isNumberValue(day)) {
    if (
      !isNumberValue(month) ||
      !isCalendarDate(year, month, day)
    ) {
      return undefined;
    }
    sanitized.day = day;
  }
  return sanitized;
}

function sameItemDate(
  left: ItemDate | undefined,
  right: ItemDate | undefined,
): boolean {
  return (
    left?.year === right?.year &&
    left?.month === right?.month &&
    left?.day === right?.day
  );
}

function palette(value: OwnDataPropertyResult): [string, string] | undefined {
  if (!isDataArray(value) || value.length !== 2) {
    return undefined;
  }
  const first = arrayElement(value, 0);
  const second = arrayElement(value, 1);
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

function sanitizeTrack(value: OwnDataPropertyResult): Track | undefined {
  if (!isOwnDataRecord(value)) return undefined;
  const id = recordProperty(value, "id");
  const title = recordProperty(value, "title");
  const artist = recordProperty(value, "artist");
  const albumTitle = recordProperty(value, "album");
  const albumId = recordProperty(value, "albumId");
  const duration = recordProperty(value, "duration");
  const trackNumber = recordProperty(value, "track");
  const paletteValue = recordProperty(value, "palette");
  const discValue = recordProperty(value, "disc");
  const albumArtistValue = recordProperty(value, "albumArtist");
  const musicBrainzIdValue = recordProperty(value, "musicBrainzId");
  const coverArtValue = recordProperty(value, "coverArt");
  const starredAtValue = recordProperty(value, "starredAt");
  const colors = palette(paletteValue);
  const disc = isCount(discValue, MAX_TRACK_NUMBER)
    ? discValue
    : undefined;
  const albumArtist = isText(albumArtistValue, false)
    ? albumArtistValue
    : undefined;
  const musicBrainzId = isMusicBrainzId(musicBrainzIdValue)
    ? musicBrainzIdValue
    : undefined;
  const coverArt = isText(coverArtValue, false)
    ? coverArtValue
    : undefined;
  const starredAt = isAbsent(starredAtValue)
    ? undefined
    : sanitizeDateText(starredAtValue);
  if (
    !isText(id) ||
    !isText(title) ||
    !isText(artist) ||
    !isText(albumTitle) ||
    !isText(albumId) ||
    !isDuration(duration) ||
    !isCount(trackNumber, MAX_TRACK_NUMBER) ||
    (!isAbsent(discValue) && disc === undefined) ||
    (!isAbsent(albumArtistValue) && albumArtist === undefined) ||
    (!isAbsent(musicBrainzIdValue) && musicBrainzId === undefined) ||
    (!isAbsent(coverArtValue) && coverArt === undefined) ||
    (!isAbsent(starredAtValue) && starredAt === undefined) ||
    !colors
  ) {
    return undefined;
  }
  const track: Track = {
    id,
    title,
    artist,
    album: albumTitle,
    albumId,
    duration,
    track: trackNumber,
    palette: colors,
  };
  if (disc !== undefined) track.disc = disc;
  if (albumArtist !== undefined) track.albumArtist = albumArtist;
  if (musicBrainzId !== undefined) track.musicBrainzId = musicBrainzId;
  if (coverArt !== undefined) track.coverArt = coverArt;
  if (starredAt !== undefined) track.starredAt = starredAt;
  return track;
}

/**
 * Durable local Favorites state contains only Bandcamp track-star reconciliation
 * metadata plus anonymous Radio favorites. Album stars are always enumerated by
 * getStarred and must never be reconstructed from this cache.
 */
export function localTrackStarIndexAndRadio(
  favorites: LocalFavoriteCollection,
): LocalFavoriteCollection {
  return {
    ...emptyLocalFavorites(),
    songIds: favorites.songIds,
    tracks: favorites.tracks,
    radioShowIds: favorites.radioShowIds,
    radioShows: favorites.radioShows,
  };
}

function sanitizeAlbum(value: OwnDataPropertyResult): Album | undefined {
  if (!isOwnDataRecord(value)) return undefined;
  const id = recordProperty(value, "id");
  const title = recordProperty(value, "title");
  const artist = recordProperty(value, "artist");
  const songCount = recordProperty(value, "songCount");
  const duration = recordProperty(value, "duration");
  const paletteValue = recordProperty(value, "palette");
  const coverArtValue = recordProperty(value, "coverArt");
  const yearValue = recordProperty(value, "year");
  const genreValue = recordProperty(value, "genre");
  const addedAtValue = recordProperty(value, "addedAt");
  const starredAtValue = recordProperty(value, "starredAt");
  const playedAtValue = recordProperty(value, "playedAt");
  const originalReleaseDateValue = recordProperty(
    value,
    "originalReleaseDate",
  );
  const releaseDateValue = recordProperty(value, "releaseDate");
  const tracksValue = recordProperty(value, "tracks");
  const colors = palette(paletteValue);
  const coverArt = isText(coverArtValue, false)
    ? coverArtValue
    : undefined;
  const year = isCount(yearValue, 9_999) && yearValue > 0
    ? yearValue
    : undefined;
  const genre = isText(genreValue, false) ? genreValue : undefined;
  const addedAt = isAbsent(addedAtValue)
    ? undefined
    : sanitizeDateText(addedAtValue);
  const starredAt = isAbsent(starredAtValue)
    ? undefined
    : sanitizeDateText(starredAtValue);
  const playedAt = isAbsent(playedAtValue)
    ? undefined
    : sanitizeDateText(playedAtValue);
  const originalReleaseDate = isAbsent(originalReleaseDateValue)
    ? undefined
    : sanitizeItemDate(originalReleaseDateValue);
  const releaseDate = isAbsent(releaseDateValue)
    ? undefined
    : sanitizeItemDate(releaseDateValue);
  if (!isAbsent(tracksValue)) {
    if (
      !isDataArray(tracksValue) ||
      tracksValue.length > MAX_TRACKS_PER_ALBUM
    ) {
      return undefined;
    }
    for (let index = 0; index < tracksValue.length; index += 1) {
      const track = sanitizeTrack(arrayElement(tracksValue, index));
      if (!track || !isText(id) || track.albumId !== id) return undefined;
    }
  }
  if (
    !isText(id) ||
    !isText(title) ||
    !isText(artist) ||
    !isCount(songCount, MAX_FAVORITE_TRACKS) ||
    !isDuration(duration) ||
    (!isAbsent(coverArtValue) && coverArt === undefined) ||
    (!isAbsent(yearValue) && year === undefined) ||
    (!isAbsent(genreValue) && genre === undefined) ||
    (!isAbsent(addedAtValue) && addedAt === undefined) ||
    (!isAbsent(starredAtValue) && starredAt === undefined) ||
    (!isAbsent(playedAtValue) && playedAt === undefined) ||
    (!isAbsent(originalReleaseDateValue) &&
      originalReleaseDate === undefined) ||
    (!isAbsent(releaseDateValue) && releaseDate === undefined) ||
    !colors
  ) {
    return undefined;
  }
  const album: Album = {
    id,
    title,
    artist,
    songCount,
    duration,
    palette: colors,
  };
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

function sanitizeRadioShow(
  value: OwnDataPropertyResult,
): RadioShowSummary | undefined {
  if (!isOwnDataRecord(value)) return undefined;
  const id = recordProperty(value, "id");
  const subtitle = recordProperty(value, "subtitle");
  const description = recordProperty(value, "description");
  const publishedAt = recordProperty(value, "publishedAt");
  const seriesValue = recordProperty(value, "series");
  const seriesId = recordProperty(seriesValue, "id");
  const seriesTitle = recordProperty(seriesValue, "title");
  const seriesSlug = recordProperty(seriesValue, "slug");
  const series = isCount(seriesId) &&
      seriesId > 0 &&
      isText(seriesTitle) &&
      isText(seriesSlug)
    ? {
        id: seriesId,
        title: seriesTitle,
        slug: seriesSlug,
      }
    : undefined;
  if (
    !isCount(id) ||
    id <= 0 ||
    !isText(subtitle) ||
    !isText(description, false) ||
    !isText(publishedAt, false)
  ) {
    return undefined;
  }
  const show: RadioShowSummary = {
    id,
    subtitle,
    description,
    publishedAt,
  };
  if (series) show.series = series;
  return show;
}

function uniqueText(
  values: OwnDataPropertyResult,
  maximum: number,
): string[] | undefined {
  if (!isDataArray(values) || values.length > maximum) return undefined;
  const unique: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < values.length; index += 1) {
    const id = arrayElement(values, index);
    if (!isText(id)) return undefined;
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  return unique;
}

function uniqueNumbers(
  values: OwnDataPropertyResult,
  maximum: number,
): number[] | undefined {
  if (!isDataArray(values) || values.length > maximum) return undefined;
  const unique: number[] = [];
  const seen = new Set<number>();
  for (let index = 0; index < values.length; index += 1) {
    const id = arrayElement(values, index);
    if (!isCount(id) || id <= 0) return undefined;
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  return unique;
}

function sanitizeFavoriteAlbums(
  values: readonly OwnDataValue[],
  wantedIds: ReadonlySet<string>,
): Album[] | undefined {
  const albums: Album[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < values.length; index += 1) {
    const album = sanitizeAlbum(arrayElement(values, index));
    if (!album) return undefined;
    if (!wantedIds.has(album.id) || seen.has(album.id)) continue;
    seen.add(album.id);
    albums.push(album);
  }
  return albums;
}

function sanitizeFavoriteTracks(
  values: readonly OwnDataValue[],
  wantedIds: ReadonlySet<string>,
): Track[] | undefined {
  const tracks: Track[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < values.length; index += 1) {
    const track = sanitizeTrack(arrayElement(values, index));
    if (!track) return undefined;
    if (!wantedIds.has(track.id) || seen.has(track.id)) continue;
    seen.add(track.id);
    tracks.push(track);
  }
  return tracks;
}

function sanitizeFavoriteRadioShows(
  values: readonly OwnDataValue[],
  wantedIds: ReadonlySet<number>,
): RadioShowSummary[] | undefined {
  const radioShows: RadioShowSummary[] = [];
  const seen = new Set<number>();
  for (let index = 0; index < values.length; index += 1) {
    const show = sanitizeRadioShow(arrayElement(values, index));
    if (!show) return undefined;
    if (!wantedIds.has(show.id) || seen.has(show.id)) continue;
    seen.add(show.id);
    radioShows.push(show);
  }
  return radioShows;
}

function sameAlbumMetadata(left: Album, right: Album): boolean {
  return (
    left.id === right.id &&
    left.title === right.title &&
    left.artist === right.artist &&
    left.songCount === right.songCount &&
    left.duration === right.duration &&
    left.coverArt === right.coverArt &&
    left.year === right.year &&
    left.genre === right.genre &&
    left.addedAt === right.addedAt &&
    left.starredAt === right.starredAt &&
    left.playedAt === right.playedAt &&
    sameItemDate(left.originalReleaseDate, right.originalReleaseDate) &&
    sameItemDate(left.releaseDate, right.releaseDate) &&
    left.palette[0] === right.palette[0] &&
    left.palette[1] === right.palette[1]
  );
}

function sameFavoriteTrack(left: Track, right: Track): boolean {
  return (
    left.id === right.id &&
    left.title === right.title &&
    left.artist === right.artist &&
    left.album === right.album &&
    left.albumId === right.albumId &&
    left.duration === right.duration &&
    left.track === right.track &&
    left.disc === right.disc &&
    left.albumArtist === right.albumArtist &&
    left.musicBrainzId === right.musicBrainzId &&
    left.coverArt === right.coverArt &&
    left.starredAt === right.starredAt &&
    left.artworkUrl === right.artworkUrl &&
    left.streamUrl === right.streamUrl &&
    left.radioChapters === right.radioChapters &&
    left.discoverRelease === right.discoverRelease &&
    left.dailySource === right.dailySource &&
    left.palette[0] === right.palette[0] &&
    left.palette[1] === right.palette[1]
  );
}

function preserveAlbumDates(candidate: Album, existing: Album): Album {
  const preserved = { ...candidate };
  if (preserved.addedAt === undefined && existing.addedAt !== undefined) {
    preserved.addedAt = existing.addedAt;
  }
  if (preserved.starredAt === undefined && existing.starredAt !== undefined) {
    preserved.starredAt = existing.starredAt;
  }
  if (preserved.playedAt === undefined && existing.playedAt !== undefined) {
    preserved.playedAt = existing.playedAt;
  }
  if (
    preserved.originalReleaseDate === undefined &&
    existing.originalReleaseDate !== undefined
  ) {
    preserved.originalReleaseDate = existing.originalReleaseDate;
  }
  if (
    preserved.releaseDate === undefined &&
    existing.releaseDate !== undefined
  ) {
    preserved.releaseDate = existing.releaseDate;
  }
  return preserved;
}

export function emptyLocalFavorites(): LocalFavoriteCollection {
  return {
    albumIds: [],
    songIds: [],
    albums: [],
    tracks: [],
    radioShowIds: [],
    radioShows: [],
  };
}

export function sanitizeLocalFavorites(
  value: OwnDataValue,
): LocalFavoriteCollection | undefined {
  if (!isOwnDataRecord(value)) return undefined;
  const albumIdsValue = recordProperty(value, "albumIds");
  const songIdsValue = recordProperty(value, "songIds");
  const albumsValue = recordProperty(value, "albums");
  const tracksValue = recordProperty(value, "tracks");
  const radioShowIdsValue = recordProperty(value, "radioShowIds");
  const radioShowsValue = recordProperty(value, "radioShows");
  const albumIds = uniqueText(albumIdsValue, MAX_FAVORITE_ALBUMS);
  const songIds = uniqueText(songIdsValue, MAX_FAVORITE_TRACKS);
  const radioShowIds = uniqueNumbers(
    isAbsent(radioShowIdsValue) ? [] : radioShowIdsValue,
    MAX_FAVORITE_RADIO_SHOWS,
  );
  const rawRadioShows = isAbsent(radioShowsValue) ? [] : radioShowsValue;
  if (
    !albumIds ||
    !songIds ||
    !radioShowIds ||
    !isDataArray(albumsValue) ||
    albumsValue.length > MAX_FAVORITE_ALBUMS ||
    !isDataArray(tracksValue) ||
    tracksValue.length > MAX_FAVORITE_TRACKS ||
    !isDataArray(rawRadioShows) ||
    rawRadioShows.length > MAX_FAVORITE_RADIO_SHOWS
  ) {
    return undefined;
  }
  const wantedAlbumIds = new Set(albumIds);
  const wantedSongIds = new Set(songIds);
  const wantedRadioShowIds = new Set(radioShowIds);
  const albums = sanitizeFavoriteAlbums(albumsValue, wantedAlbumIds);
  const tracks = sanitizeFavoriteTracks(tracksValue, wantedSongIds);
  const radioShows = sanitizeFavoriteRadioShows(
    rawRadioShows,
    wantedRadioShowIds,
  );
  if (!albums || !tracks || !radioShows) return undefined;
  return {
    albumIds,
    songIds,
    radioShowIds,
    albums,
    tracks,
    radioShows,
  };
}

export function readLocalFavorites(): LocalFavoriteCollection {
  if (!("window" in globalThis)) return emptyLocalFavorites();
  try {
    const serialized = window.localStorage.getItem(LOCAL_FAVORITES_KEY);
    if (!serialized) return emptyLocalFavorites();
    const favorites = parseLocalFavoritesSerialized(serialized);
    if (!favorites) {
      window.localStorage.removeItem(LOCAL_FAVORITES_KEY);
      return emptyLocalFavorites();
    }
    return favorites;
  } catch {
    // Treat inaccessible or malformed local state as empty.
  }
  try {
    window.localStorage.removeItem(LOCAL_FAVORITES_KEY);
  } catch {
    // Storage can be disabled by the host; empty state is still safe.
  }
  return emptyLocalFavorites();
}

export function parseLocalFavoritesSnapshot(
  value: OwnDataValue,
): LocalFavoriteCollection | undefined {
  const version = recordProperty(value, "version");
  if (
    !isOwnDataRecord(value) ||
    !isNumberValue(version) ||
    !Number.isSafeInteger(version) ||
    ![1, 2, LOCAL_FAVORITES_VERSION].includes(version)
  ) {
    return undefined;
  }
  const sanitized = sanitizeLocalFavorites(value);
  if (!sanitized) return undefined;
  if (version === LOCAL_FAVORITES_VERSION) {
    return localTrackStarIndexAndRadio(sanitized);
  }
  return {
    ...emptyLocalFavorites(),
    radioShowIds: sanitized.radioShowIds,
    radioShows: sanitized.radioShows,
  };
}

export function createLocalFavoritesSnapshot(
  favorites: LocalFavoriteCollection,
): LocalFavoritesSnapshot {
  const sanitized = sanitizeLocalFavorites(
    localTrackStarIndexAndRadio(favorites),
  );
  if (!sanitized) throw new Error("Local favorites contain invalid music metadata.");
  return {
    version: LOCAL_FAVORITES_VERSION,
    ...sanitized,
  };
}

export function writeLocalFavorites(
  favorites: LocalFavoriteCollection,
): LocalFavoriteCollection {
  const snapshot = createLocalFavoritesSnapshot(favorites);
  const serialized = JSON.stringify(snapshot);
  if (serialized.length > MAX_LOCAL_FAVORITES_BYTES) {
    throw new Error("Local favorites are too large to save safely.");
  }
  window.localStorage.setItem(LOCAL_FAVORITES_KEY, serialized);
  const { version: _version, ...sanitized } = snapshot;
  return sanitized;
}

export function updateLocalFavorites(
  current: LocalFavoriteCollection,
  input: FavoriteInput,
  candidate?: OwnDataValue,
): LocalFavoriteCollection {
  if (input.kind === "song") {
    if (input.favorite && !localTrackStarIndexCanAccept(current, input.id)) {
      throw new Error(localTrackStarBoundMessage());
    }
    const songIds = current.songIds.filter((id) => id !== input.id);
    const tracks = current.tracks.filter((track) => track.id !== input.id);
    if (!input.favorite) return { ...current, songIds, tracks };
    const track = sanitizeTrack(candidate);
    return {
      ...current,
      songIds: [input.id, ...songIds],
      tracks: track ? [track, ...tracks] : tracks,
    };
  }

  if (
    input.favorite &&
    !current.albumIds.includes(input.id) &&
    current.albumIds.length >= MAX_FAVORITE_ALBUMS
  ) {
    throw new Error(`Coda can save at most ${MAX_FAVORITE_ALBUMS.toLocaleString()} favorite albums.`);
  }
  const albumIds = current.albumIds.filter((id) => id !== input.id);
  const albums = current.albums.filter((album) => album.id !== input.id);
  if (!input.favorite) return { ...current, albumIds, albums };
  const album = sanitizeAlbum(candidate);
  return {
    ...current,
    albumIds: [input.id, ...albumIds],
    albums: album ? [album, ...albums] : albums,
  };
}

export function reconcileLocalTrackStarIndex(
  current: LocalFavoriteCollection,
  confirmedStarred: readonly Track[],
  confirmedUnstarredIds: readonly string[] = [],
): LocalFavoriteCollection {
  const unstarredIds = new Set(confirmedUnstarredIds);
  const remainingSongIds: string[] = [];
  for (const id of current.songIds) {
    if (!unstarredIds.has(id)) remainingSongIds.push(id);
  }
  const remainingTracks: Track[] = [];
  const tracksById = new Map<string, Track>();
  for (const track of current.tracks) {
    if (unstarredIds.has(track.id)) continue;
    remainingTracks.push(track);
    tracksById.set(track.id, track);
  }
  const indexedIds = new Set(remainingSongIds);
  const updatedIds: string[] = [];
  const updatedTracks: Track[] = [];
  const updatedIdSet = new Set<string>();
  let changed =
    remainingSongIds.length !== current.songIds.length ||
    remainingTracks.length !== current.tracks.length;

  for (const candidate of confirmedStarred) {
    if (candidate.starredAt === undefined) continue;
    const track = sanitizeTrack(candidate);
    if (!track) continue;
    const existing = tracksById.get(track.id);
    if (
      indexedIds.has(track.id) &&
      existing !== undefined &&
      sameFavoriteTrack(existing, track)
    ) {
      continue;
    }
    if (!indexedIds.has(track.id) && indexedIds.size >= MAX_FAVORITE_TRACKS) {
      throw new Error(localTrackStarBoundMessage());
    }
    changed = true;
    if (updatedIdSet.has(track.id)) {
      const updatedIndex = updatedIds.indexOf(track.id);
      if (updatedIndex >= 0) {
        updatedIds.splice(updatedIndex, 1);
        updatedTracks.splice(updatedIndex, 1);
      }
    }
    updatedIds.push(track.id);
    updatedTracks.push(track);
    updatedIdSet.add(track.id);
    indexedIds.add(track.id);
    tracksById.set(track.id, track);
  }

  if (!changed) return current;

  updatedIds.reverse();
  updatedTracks.reverse();
  const songIds = updatedIds.length === 0
    ? remainingSongIds
    : updatedIds.concat(
      remainingSongIds.filter((id) => !updatedIdSet.has(id)),
    );
  const tracks = updatedTracks.length === 0
    ? remainingTracks
    : updatedTracks.concat(
      remainingTracks.filter((track) => !updatedIdSet.has(track.id)),
    );
  return { ...current, songIds, tracks };
}

export function updateLocalRadioFavorite(
  current: LocalFavoriteCollection,
  show: RadioShowSummary,
  favorite: boolean,
): LocalFavoriteCollection {
  if (
    favorite &&
    !current.radioShowIds.includes(show.id) &&
    current.radioShowIds.length >= MAX_FAVORITE_RADIO_SHOWS
  ) {
    throw new Error(
      `Coda can save at most ${MAX_FAVORITE_RADIO_SHOWS.toLocaleString()} favorite radio shows.`,
    );
  }
  const radioShowIds = current.radioShowIds.filter((id) => id !== show.id);
  const radioShows = current.radioShows.filter((item) => item.id !== show.id);
  if (!favorite) return { ...current, radioShowIds, radioShows };
  const sanitized = sanitizeRadioShow(show);
  if (!sanitized) throw new Error("Radio favorite contains invalid show metadata.");
  return {
    ...current,
    radioShowIds: [sanitized.id, ...radioShowIds],
    radioShows: [sanitized, ...radioShows],
  };
}

export function repairLocalFavoriteMetadata(
  current: LocalFavoriteCollection,
  albumCandidates: readonly OwnDataValue[],
  trackCandidates: readonly OwnDataValue[],
): LocalFavoriteCollection {
  const existingAlbums = new Map(current.albums.map((album) => [album.id, album]));
  const existingTrackIds = new Set(current.tracks.map((track) => track.id));
  const wantedAlbumIds = new Set(current.albumIds);
  const wantedTrackIds = new Set(current.songIds);
  const repairedAlbums: Album[] = [];
  for (const candidate of albumCandidates) {
    const album = sanitizeAlbum(candidate);
    if (!album || !wantedAlbumIds.has(album.id)) continue;
    const existing = existingAlbums.get(album.id);
    const repaired = existing ? preserveAlbumDates(album, existing) : album;
    if (!existing || !sameAlbumMetadata(existing, repaired)) {
      repairedAlbums.push(repaired);
    }
  }
  const repairedTracks: Track[] = [];
  for (const candidate of trackCandidates) {
    const track = sanitizeTrack(candidate);
    if (
      track &&
      wantedTrackIds.has(track.id) &&
      !existingTrackIds.has(track.id)
    ) {
      repairedTracks.push(track);
    }
  }

  if (!repairedAlbums.length && !repairedTracks.length) return current;
  const repairedAlbumMap = new Map(repairedAlbums.map((album) => [album.id, album]));
  const albums = current.albums.map(
    (album) => repairedAlbumMap.get(album.id) ?? album,
  );
  const albumIds = new Set(albums.map((album) => album.id));
  for (const album of repairedAlbums) {
    if (albumIds.has(album.id)) continue;
    albumIds.add(album.id);
    albums.push(album);
  }
  const tracks = [...current.tracks];
  const trackIds = new Set(tracks.map((track) => track.id));
  for (const track of repairedTracks) {
    if (trackIds.has(track.id)) continue;
    trackIds.add(track.id);
    tracks.push(track);
  }
  return {
    ...current,
    albums,
    tracks,
  };
}
