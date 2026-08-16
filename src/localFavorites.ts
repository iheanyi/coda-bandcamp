import type {
  Album,
  FavoriteInput,
  ItemDate,
  LocalFavoriteCollection,
  RadioShowSummary,
  Track,
} from "./types";
import { isItemDate, parseLibraryDate } from "./libraryDates";

export const LOCAL_FAVORITES_KEY = "coda.local-favorites.v1";

export const LOCAL_FAVORITES_VERSION = 3;
export const MAX_FAVORITE_ALBUMS = 5_000;
export const MAX_FAVORITE_TRACKS = 25_000;
export const MAX_FAVORITE_RADIO_SHOWS = 5_000;
const MAX_TRACKS_PER_ALBUM = 5_000;
export const MAX_LOCAL_FAVORITES_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_LENGTH = 1_024;
const MAX_DURATION_SECONDS = 7 * 24 * 60 * 60;

export type LocalFavoritesSnapshot = LocalFavoriteCollection & {
  version: typeof LOCAL_FAVORITES_VERSION;
};

type LocalFavoritesWireRecord = {
  [field: string]: LocalFavoritesWireValue;
};

export type LocalFavoritesWireValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | LocalFavoritesWireValue[]
  | LocalFavoritesWireRecord;

export function parseLocalFavoritesSerialized(
  serialized: string,
): LocalFavoriteCollection | undefined {
  if (serialized.length > MAX_LOCAL_FAVORITES_BYTES) return undefined;
  try {
    return parseLocalFavoritesSnapshot(JSON.parse(serialized));
  } catch {
    return undefined;
  }
}

function isRecord(
  value: LocalFavoritesWireValue,
): value is LocalFavoritesWireRecord {
  return (
    value !== null &&
    value !== undefined &&
    Object(value) === value &&
    !Array.isArray(value)
  );
}

function isWireArray(
  value: LocalFavoritesWireValue,
): value is LocalFavoritesWireValue[] {
  return Array.isArray(value);
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || (codeUnit >= 0x7f && codeUnit <= 0x9f)) {
      return true;
    }
  }
  return false;
}

function isText(
  value: LocalFavoritesWireValue,
  required = true,
): value is string {
  return (
    String(value) === value &&
    value.length <= MAX_TEXT_LENGTH &&
    (!required || value.length > 0) &&
    !hasControlCharacters(value)
  );
}

function isCount(value: LocalFavoritesWireValue): value is number {
  return Number(value) === value && Number.isSafeInteger(value) && value >= 0;
}

function isDuration(value: LocalFavoritesWireValue): value is number {
  return (
    Number(value) === value &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_DURATION_SECONDS
  );
}

function isMusicBrainzId(value: LocalFavoritesWireValue): value is string {
  return (
    String(value) === value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value)
  );
}

function isAbsent(
  value: LocalFavoritesWireValue,
): value is null | undefined {
  return value === undefined || value === null;
}

function sanitizeDateText(
  value: LocalFavoritesWireValue,
): string | undefined {
  return isText(value, false) && parseLibraryDate(value) !== undefined
    ? value
    : undefined;
}

function sanitizeItemDate(
  value: LocalFavoritesWireValue,
): ItemDate | undefined {
  if (!isItemDate(value)) return undefined;
  const sanitized: ItemDate = { year: value.year };
  if (value.month !== undefined) sanitized.month = value.month;
  if (value.day !== undefined) sanitized.day = value.day;
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

function palette(
  value: LocalFavoritesWireValue,
): [string, string] | undefined {
  if (!isWireArray(value) || value.length !== 2) {
    return undefined;
  }
  const [first, second] = value;
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

function sanitizeTrack(value: LocalFavoritesWireValue): Track | undefined {
  if (!isRecord(value)) return undefined;
  const colors = palette(value.palette);
  const disc = isCount(value.disc) ? value.disc : undefined;
  const albumArtist = isText(value.albumArtist, false)
    ? value.albumArtist
    : undefined;
  const musicBrainzId = isMusicBrainzId(value.musicBrainzId)
    ? value.musicBrainzId
    : undefined;
  const coverArt = isText(value.coverArt, false)
    ? value.coverArt
    : undefined;
  const starredAt = isAbsent(value.starredAt)
    ? undefined
    : sanitizeDateText(value.starredAt);
  if (
    !isText(value.id) ||
    !isText(value.title) ||
    !isText(value.artist) ||
    !isText(value.album) ||
    !isText(value.albumId) ||
    !isDuration(value.duration) ||
    !isCount(value.track) ||
    (!isAbsent(value.disc) && disc === undefined) ||
    (!isAbsent(value.albumArtist) && albumArtist === undefined) ||
    (!isAbsent(value.musicBrainzId) && musicBrainzId === undefined) ||
    (!isAbsent(value.coverArt) && coverArt === undefined) ||
    (!isAbsent(value.starredAt) && starredAt === undefined) ||
    !colors
  ) {
    return undefined;
  }
  const track: Track = {
    id: value.id,
    title: value.title,
    artist: value.artist,
    album: value.album,
    albumId: value.albumId,
    duration: value.duration,
    track: value.track,
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

function sanitizeAlbum(value: LocalFavoritesWireValue): Album | undefined {
  if (!isRecord(value)) return undefined;
  const colors = palette(value.palette);
  const coverArt = isText(value.coverArt, false)
    ? value.coverArt
    : undefined;
  const year = isCount(value.year) ? value.year : undefined;
  const genre = isText(value.genre, false) ? value.genre : undefined;
  const addedAt = isAbsent(value.addedAt)
    ? undefined
    : sanitizeDateText(value.addedAt);
  const starredAt = isAbsent(value.starredAt)
    ? undefined
    : sanitizeDateText(value.starredAt);
  const playedAt = isAbsent(value.playedAt)
    ? undefined
    : sanitizeDateText(value.playedAt);
  const originalReleaseDate = isAbsent(value.originalReleaseDate)
    ? undefined
    : sanitizeItemDate(value.originalReleaseDate);
  const releaseDate = isAbsent(value.releaseDate)
    ? undefined
    : sanitizeItemDate(value.releaseDate);
  let tracks: Track[] | undefined;
  if (!isAbsent(value.tracks)) {
    if (!isWireArray(value.tracks) || value.tracks.length > MAX_TRACKS_PER_ALBUM) {
      return undefined;
    }
    tracks = sanitizeItems(value.tracks, sanitizeTrack);
    if (!tracks) return undefined;
  }
  if (
    !isText(value.id) ||
    !isText(value.title) ||
    !isText(value.artist) ||
    !isCount(value.songCount) ||
    !isDuration(value.duration) ||
    (!isAbsent(value.coverArt) && coverArt === undefined) ||
    (!isAbsent(value.year) && year === undefined) ||
    (!isAbsent(value.genre) && genre === undefined) ||
    (!isAbsent(value.addedAt) && addedAt === undefined) ||
    (!isAbsent(value.starredAt) && starredAt === undefined) ||
    (!isAbsent(value.playedAt) && playedAt === undefined) ||
    (!isAbsent(value.originalReleaseDate) && originalReleaseDate === undefined) ||
    (!isAbsent(value.releaseDate) && releaseDate === undefined) ||
    (tracks !== undefined && tracks.some((track) => track.albumId !== value.id)) ||
    !colors
  ) {
    return undefined;
  }
  const album: Album = {
    id: value.id,
    title: value.title,
    artist: value.artist,
    songCount: value.songCount,
    duration: value.duration,
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
  value: LocalFavoritesWireValue,
): RadioShowSummary | undefined {
  const series = isRecord(value) && isRecord(value.series) &&
    Number.isSafeInteger(value.series.id) &&
    Number(value.series.id) > 0 &&
    isText(value.series.title) &&
    isText(value.series.slug)
    ? {
        id: Number(value.series.id),
        title: value.series.title,
        slug: value.series.slug,
      }
    : undefined;
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.id) ||
    Number(value.id) <= 0 ||
    !isText(value.subtitle) ||
    !isText(value.description, false) ||
    !isText(value.publishedAt, false)
  ) {
    return undefined;
  }
  const show: RadioShowSummary = {
    id: Number(value.id),
    subtitle: value.subtitle,
    description: value.description,
    publishedAt: value.publishedAt,
  };
  if (series) show.series = series;
  return show;
}

function uniqueText(
  values: LocalFavoritesWireValue,
  maximum: number,
): string[] | undefined {
  if (
    !isWireArray(values) ||
    values.length > maximum ||
    !values.every((id) => isText(id))
  ) {
    return undefined;
  }
  return [...new Set(values)];
}

function uniqueNumbers(
  values: LocalFavoritesWireValue,
  maximum: number,
): number[] | undefined {
  if (
    !isWireArray(values) ||
    values.length > maximum ||
    !values.every((id) => Number.isSafeInteger(id) && Number(id) > 0)
  ) {
    return undefined;
  }
  return [...new Set(values.map(Number))];
}

function sanitizeItems<Item>(
  values: LocalFavoritesWireValue[],
  sanitize: (value: LocalFavoritesWireValue) => Item | undefined,
): Item[] | undefined {
  const sanitized: Item[] = [];
  for (const value of values) {
    const item = sanitize(value);
    if (item === undefined) return undefined;
    sanitized.push(item);
  }
  return sanitized;
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function uniqueRadioShows(items: RadioShowSummary[]): RadioShowSummary[] {
  const seen = new Set<number>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
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
  value: LocalFavoritesWireValue,
): LocalFavoriteCollection | undefined {
  if (!isRecord(value)) return undefined;
  const albumIds = uniqueText(value.albumIds, MAX_FAVORITE_ALBUMS);
  const songIds = uniqueText(value.songIds, MAX_FAVORITE_TRACKS);
  const radioShowIds = uniqueNumbers(
    isAbsent(value.radioShowIds) ? [] : value.radioShowIds,
    MAX_FAVORITE_RADIO_SHOWS,
  );
  const rawRadioShows = isAbsent(value.radioShows) ? [] : value.radioShows;
  if (
    !albumIds ||
    !songIds ||
    !radioShowIds ||
    !isWireArray(value.albums) ||
    value.albums.length > MAX_FAVORITE_ALBUMS ||
    !isWireArray(value.tracks) ||
    value.tracks.length > MAX_FAVORITE_TRACKS ||
    !isWireArray(rawRadioShows) ||
    rawRadioShows.length > MAX_FAVORITE_RADIO_SHOWS
  ) {
    return undefined;
  }
  const wantedAlbumIds = new Set(albumIds);
  const wantedSongIds = new Set(songIds);
  const wantedRadioShowIds = new Set(radioShowIds);
  const albums = sanitizeItems(value.albums, sanitizeAlbum);
  const tracks = sanitizeItems(value.tracks, sanitizeTrack);
  const radioShows = sanitizeItems(rawRadioShows, sanitizeRadioShow);
  if (!albums || !tracks || !radioShows) return undefined;
  return {
    albumIds,
    songIds,
    radioShowIds,
    albums: uniqueById(albums).filter((album) => wantedAlbumIds.has(album.id)),
    tracks: uniqueById(tracks).filter((track) => wantedSongIds.has(track.id)),
    radioShows: uniqueRadioShows(radioShows)
      .filter((show) => wantedRadioShowIds.has(show.id)),
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
  value: LocalFavoritesWireValue,
): LocalFavoriteCollection | undefined {
  if (
    !isRecord(value) ||
    ![1, 2, LOCAL_FAVORITES_VERSION].includes(Number(value.version))
  ) {
    return undefined;
  }
  const sanitized = sanitizeLocalFavorites(value);
  if (!sanitized) return undefined;
  if (value.version === LOCAL_FAVORITES_VERSION) {
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
  candidate?: Album | Track,
): LocalFavoriteCollection {
  if (input.kind === "song") {
    if (
      input.favorite &&
      !current.songIds.includes(input.id) &&
      current.songIds.length >= MAX_FAVORITE_TRACKS
    ) {
      throw new Error(`Coda can save at most ${MAX_FAVORITE_TRACKS.toLocaleString()} favorite tracks.`);
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
  const songIds = current.songIds.filter((id) => !unstarredIds.has(id));
  const tracks = current.tracks.filter((track) => !unstarredIds.has(track.id));
  let next: LocalFavoriteCollection =
    songIds.length === current.songIds.length &&
      tracks.length === current.tracks.length
      ? current
      : { ...current, songIds, tracks };
  for (const candidate of confirmedStarred) {
    if (candidate.starredAt === undefined) continue;
    const track = sanitizeTrack(candidate);
    if (!track) continue;
    const existing = next.tracks.find((item) => item.id === track.id);
    if (
      next.songIds.includes(track.id) &&
      existing !== undefined &&
      JSON.stringify(existing) === JSON.stringify(track)
    ) {
      continue;
    }
    next = updateLocalFavorites(
      next,
      { id: track.id, kind: "song", favorite: true, albumId: track.albumId },
      track,
    );
  }
  return next;
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
  albumCandidates: readonly LocalFavoritesWireValue[],
  trackCandidates: readonly LocalFavoritesWireValue[],
): LocalFavoriteCollection {
  const existingAlbums = new Map(current.albums.map((album) => [album.id, album]));
  const existingTrackIds = new Set(current.tracks.map((track) => track.id));
  const wantedAlbumIds = new Set(current.albumIds);
  const wantedTrackIds = new Set(current.songIds);
  const repairedAlbums = albumCandidates
    .map(sanitizeAlbum)
    .filter((album): album is Album => Boolean(album))
    .filter((album) => wantedAlbumIds.has(album.id))
    .map((album) => {
      const existing = existingAlbums.get(album.id);
      return existing ? preserveAlbumDates(album, existing) : album;
    })
    .filter((album) => {
      const existing = existingAlbums.get(album.id);
      return !existing || !sameAlbumMetadata(existing, album);
    });
  const repairedTracks = trackCandidates
    .map(sanitizeTrack)
    .filter((track): track is Track => Boolean(track))
    .filter(
      (track) =>
        wantedTrackIds.has(track.id) && !existingTrackIds.has(track.id),
    );

  if (!repairedAlbums.length && !repairedTracks.length) return current;
  const repairedAlbumMap = new Map(repairedAlbums.map((album) => [album.id, album]));
  return {
    ...current,
    albums: uniqueById([
      ...current.albums.map((album) => repairedAlbumMap.get(album.id) ?? album),
      ...repairedAlbums,
    ]),
    tracks: uniqueById([...current.tracks, ...repairedTracks]),
  };
}
