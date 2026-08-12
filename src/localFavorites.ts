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

export const LOCAL_FAVORITES_VERSION = 2;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown, required = true): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_TEXT_LENGTH &&
    (!required || value.length > 0) &&
    !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
  );
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isDuration(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_DURATION_SECONDS
  );
}

function isMusicBrainzId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value)
  );
}

function isAbsent(value: unknown): value is null | undefined {
  return value === undefined || value === null;
}

function sanitizeDateText(value: unknown): string | undefined {
  return isText(value, false) && parseLibraryDate(value) !== undefined
    ? value
    : undefined;
}

function sanitizeItemDate(value: unknown): ItemDate | undefined {
  if (!isItemDate(value)) return undefined;
  return {
    year: value.year,
    ...(value.month === undefined ? {} : { month: value.month }),
    ...(value.day === undefined ? {} : { day: value.day }),
  };
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

function palette(value: unknown): [string, string] | undefined {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !value.every((item) => isText(item) && item.length <= 64)
  ) {
    return undefined;
  }
  return [value[0], value[1]];
}

function sanitizeTrack(value: unknown): Track | undefined {
  if (!isRecord(value)) return undefined;
  const colors = palette(value.palette);
  if (
    !isText(value.id) ||
    !isText(value.title) ||
    !isText(value.artist) ||
    !isText(value.album) ||
    !isText(value.albumId) ||
    !isDuration(value.duration) ||
    !isCount(value.track) ||
    (!isAbsent(value.disc) && !isCount(value.disc)) ||
    (!isAbsent(value.albumArtist) && !isText(value.albumArtist, false)) ||
    (!isAbsent(value.musicBrainzId) && !isMusicBrainzId(value.musicBrainzId)) ||
    (!isAbsent(value.coverArt) && !isText(value.coverArt, false)) ||
    !colors
  ) {
    return undefined;
  }
  return {
    id: value.id,
    title: value.title,
    artist: value.artist,
    album: value.album,
    albumId: value.albumId,
    duration: value.duration,
    track: value.track,
    ...(isAbsent(value.disc) ? {} : { disc: value.disc }),
    ...(isAbsent(value.albumArtist) ? {} : { albumArtist: value.albumArtist }),
    ...(isAbsent(value.musicBrainzId) ? {} : { musicBrainzId: value.musicBrainzId }),
    ...(isAbsent(value.coverArt) ? {} : { coverArt: value.coverArt }),
    palette: colors,
  };
}

function sanitizeAlbum(value: unknown): Album | undefined {
  if (!isRecord(value)) return undefined;
  const colors = palette(value.palette);
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
  const tracks = isAbsent(value.tracks)
    ? undefined
    : Array.isArray(value.tracks) && value.tracks.length <= MAX_TRACKS_PER_ALBUM
      ? value.tracks.map(sanitizeTrack)
      : undefined;
  if (
    !isText(value.id) ||
    !isText(value.title) ||
    !isText(value.artist) ||
    !isCount(value.songCount) ||
    !isDuration(value.duration) ||
    (!isAbsent(value.coverArt) && !isText(value.coverArt, false)) ||
    (!isAbsent(value.year) && !isCount(value.year)) ||
    (!isAbsent(value.genre) && !isText(value.genre, false)) ||
    (!isAbsent(value.addedAt) && addedAt === undefined) ||
    (!isAbsent(value.starredAt) && starredAt === undefined) ||
    (!isAbsent(value.playedAt) && playedAt === undefined) ||
    (!isAbsent(value.originalReleaseDate) && originalReleaseDate === undefined) ||
    (!isAbsent(value.releaseDate) && releaseDate === undefined) ||
    (!isAbsent(value.tracks) &&
      (!tracks ||
        tracks.some((track) => !track || track.albumId !== value.id))) ||
    !colors
  ) {
    return undefined;
  }
  return {
    id: value.id,
    title: value.title,
    artist: value.artist,
    songCount: value.songCount,
    duration: value.duration,
    ...(isAbsent(value.coverArt) ? {} : { coverArt: value.coverArt }),
    ...(isAbsent(value.year) ? {} : { year: value.year }),
    ...(isAbsent(value.genre) ? {} : { genre: value.genre }),
    ...(addedAt === undefined ? {} : { addedAt }),
    ...(starredAt === undefined ? {} : { starredAt }),
    ...(playedAt === undefined ? {} : { playedAt }),
    ...(originalReleaseDate === undefined ? {} : { originalReleaseDate }),
    ...(releaseDate === undefined ? {} : { releaseDate }),
    palette: colors,
  };
}

function sanitizeRadioShow(value: unknown): RadioShowSummary | undefined {
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
  return {
    id: Number(value.id),
    subtitle: value.subtitle,
    description: value.description,
    publishedAt: value.publishedAt,
    ...(series ? { series } : {}),
  };
}

function uniqueText(values: unknown, maximum: number): string[] | undefined {
  if (!Array.isArray(values) || values.length > maximum || !values.every((id) => isText(id))) {
    return undefined;
  }
  return [...new Set(values)];
}

function uniqueNumbers(values: unknown, maximum: number): number[] | undefined {
  if (
    !Array.isArray(values) ||
    values.length > maximum ||
    !values.every((id) => Number.isSafeInteger(id) && Number(id) > 0)
  ) {
    return undefined;
  }
  return [...new Set(values.map(Number))];
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
  return {
    ...candidate,
    ...(candidate.addedAt === undefined && existing.addedAt !== undefined
      ? { addedAt: existing.addedAt }
      : {}),
    ...(candidate.starredAt === undefined && existing.starredAt !== undefined
      ? { starredAt: existing.starredAt }
      : {}),
    ...(candidate.playedAt === undefined && existing.playedAt !== undefined
      ? { playedAt: existing.playedAt }
      : {}),
    ...(candidate.originalReleaseDate === undefined &&
        existing.originalReleaseDate !== undefined
      ? { originalReleaseDate: existing.originalReleaseDate }
      : {}),
    ...(candidate.releaseDate === undefined && existing.releaseDate !== undefined
      ? { releaseDate: existing.releaseDate }
      : {}),
  };
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

export function sanitizeLocalFavorites(value: unknown): LocalFavoriteCollection | undefined {
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
    !Array.isArray(value.albums) ||
    value.albums.length > MAX_FAVORITE_ALBUMS ||
    !Array.isArray(value.tracks) ||
    value.tracks.length > MAX_FAVORITE_TRACKS ||
    !Array.isArray(rawRadioShows) ||
    rawRadioShows.length > MAX_FAVORITE_RADIO_SHOWS
  ) {
    return undefined;
  }
  const wantedAlbumIds = new Set(albumIds);
  const wantedSongIds = new Set(songIds);
  const wantedRadioShowIds = new Set(radioShowIds);
  const albums = value.albums.map(sanitizeAlbum);
  const tracks = value.tracks.map(sanitizeTrack);
  const radioShows = rawRadioShows.map(sanitizeRadioShow);
  if (
    albums.some((item) => !item) ||
    tracks.some((item) => !item) ||
    radioShows.some((item) => !item)
  ) {
    return undefined;
  }
  return {
    albumIds,
    songIds,
    radioShowIds,
    albums: uniqueById(albums as Album[]).filter((album) => wantedAlbumIds.has(album.id)),
    tracks: uniqueById(tracks as Track[]).filter((track) => wantedSongIds.has(track.id)),
    radioShows: uniqueRadioShows(radioShows as RadioShowSummary[])
      .filter((show) => wantedRadioShowIds.has(show.id)),
  };
}

export function readLocalFavorites(): LocalFavoriteCollection {
  if (typeof window === "undefined") return emptyLocalFavorites();
  try {
    const serialized = window.localStorage.getItem(LOCAL_FAVORITES_KEY);
    if (!serialized) return emptyLocalFavorites();
    if (serialized.length > MAX_LOCAL_FAVORITES_BYTES) {
      window.localStorage.removeItem(LOCAL_FAVORITES_KEY);
      return emptyLocalFavorites();
    }
    const value: unknown = JSON.parse(serialized);
    const favorites = parseLocalFavoritesSnapshot(value);
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
  value: unknown,
): LocalFavoriteCollection | undefined {
  if (
    !isRecord(value) ||
    (value.version !== 1 && value.version !== LOCAL_FAVORITES_VERSION)
  ) {
    return undefined;
  }
  return sanitizeLocalFavorites(value);
}

export function createLocalFavoritesSnapshot(
  favorites: LocalFavoriteCollection,
): LocalFavoritesSnapshot {
  const sanitized = sanitizeLocalFavorites(favorites);
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
  albumCandidates: readonly Album[],
  trackCandidates: readonly Track[],
): LocalFavoriteCollection {
  const existingAlbums = new Map(current.albums.map((album) => [album.id, album]));
  const existingTrackIds = new Set(current.tracks.map((track) => track.id));
  const wantedAlbumIds = new Set(current.albumIds);
  const wantedTrackIds = new Set(current.songIds);
  const repairedAlbums = albumCandidates
    .filter((album) => wantedAlbumIds.has(album.id))
    .map(sanitizeAlbum)
    .filter((album): album is Album => Boolean(album))
    .map((album) => {
      const existing = existingAlbums.get(album.id);
      return existing ? preserveAlbumDates(album, existing) : album;
    })
    .filter((album) => {
      const existing = existingAlbums.get(album.id);
      return !existing || !sameAlbumMetadata(existing, album);
    });
  const repairedTracks = trackCandidates
    .filter((track) => wantedTrackIds.has(track.id) && !existingTrackIds.has(track.id))
    .map(sanitizeTrack)
    .filter((track): track is Track => Boolean(track));

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
