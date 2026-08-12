import { artistKey, type LibraryBrowseMode } from "@/libraryBrowse";
import { BANDCAMP_RADIO_SERIES } from "@/radioSeries";
import type { DiscoverFilters, DiscoverSort, SortMode } from "@/types";

// Keep URL inputs at or below the corresponding native validation boundaries.
export const MAX_ROUTE_SEARCH_TEXT_BYTES = 1_024;
export const MAX_DISCOVER_TAG_BYTES = 64;
export const MAX_SUBSONIC_ROUTE_ID_BYTES = 512;
export const MAX_DISCOVER_RELEASE_ID_BYTES = 512;
export const MAX_ARTIST_KEY_BYTES = 1_024;
export const MAX_RADIO_SHOW_ID = 1_000_000;

declare const routeIdentityBrand: unique symbol;

type RouteIdentity<
  Value extends string | number,
  Domain extends string,
> = Value & Readonly<{ [routeIdentityBrand]: Domain }>;

export type AlbumId = RouteIdentity<string, "album">;
export type PlaylistId = RouteIdentity<string, "playlist">;
export type DiscoverReleaseId = RouteIdentity<string, "discover-release">;
export type ArtistKey = RouteIdentity<string, "artist">;
export type RadioSeriesId = (typeof BANDCAMP_RADIO_SERIES)[number]["id"];
export type RadioShowId = RouteIdentity<number, "radio-show">;

export type CollectionRouteSearch = Readonly<{
  q: string;
  genre: string;
  sort: SortMode;
  mode: LibraryBrowseMode;
}>;

export type DiscoverRouteSearch = Readonly<DiscoverFilters>;

export const DEFAULT_COLLECTION_ROUTE_SEARCH: CollectionRouteSearch =
  Object.freeze({
    q: "",
    genre: "All",
    sort: "recent",
    mode: "releases",
  });

export const DEFAULT_DISCOVER_ROUTE_SEARCH: DiscoverRouteSearch = Object.freeze(
  {
    tag: "",
    sort: "top",
  },
);

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;
const ABSOLUTE_URL = /^[a-z][a-z\d+.-]*:\/\//iu;

function isPlainUnknownRecord(
  value: unknown,
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;
    if (codePoint <= 0x7f) bytes += 1;
    else if (codePoint <= 0x7ff) bytes += 2;
    else if (codePoint <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

function normalizedSearchText({
  allowEmpty,
  fallback,
  maxBytes,
  value,
}: Readonly<{
  allowEmpty: boolean;
  fallback: string;
  maxBytes: number;
  value: unknown;
}>): string {
  if (
    typeof value !== "string" ||
    value.length > maxBytes ||
    CONTROL_CHARACTERS.test(value)
  ) {
    return fallback;
  }

  const normalized = value.trim();
  if (
    (!allowEmpty && normalized.length === 0) ||
    utf8ByteLength(normalized) > maxBytes
  ) {
    return fallback;
  }
  return normalized;
}

function collectionSort(value: unknown): SortMode {
  switch (value) {
    case "recent":
    case "artist":
    case "title":
    case "year":
      return value;
    default:
      return DEFAULT_COLLECTION_ROUTE_SEARCH.sort;
  }
}

function collectionMode(value: unknown): LibraryBrowseMode {
  switch (value) {
    case "releases":
    case "artists":
    case "albums":
    case "singles":
      return value;
    default:
      return DEFAULT_COLLECTION_ROUTE_SEARCH.mode;
  }
}

function discoverSort(value: unknown): DiscoverSort {
  switch (value) {
    case "top":
    case "new":
      return value;
    default:
      return DEFAULT_DISCOVER_ROUTE_SEARCH.sort;
  }
}

export function validateCollectionSearch(
  value: unknown,
): CollectionRouteSearch {
  const search = isPlainUnknownRecord(value) ? value : {};
  const genre = normalizedSearchText({
    allowEmpty: false,
    fallback: DEFAULT_COLLECTION_ROUTE_SEARCH.genre,
    maxBytes: MAX_ROUTE_SEARCH_TEXT_BYTES,
    value: search.genre,
  });

  return {
    q: normalizedSearchText({
      allowEmpty: true,
      fallback: DEFAULT_COLLECTION_ROUTE_SEARCH.q,
      maxBytes: MAX_ROUTE_SEARCH_TEXT_BYTES,
      value: search.q,
    }),
    genre: genre.toLocaleLowerCase("en-US") === "all" ? "All" : genre,
    sort: collectionSort(search.sort),
    mode: collectionMode(search.mode),
  };
}

export function validateDiscoverSearch(value: unknown): DiscoverRouteSearch {
  const search = isPlainUnknownRecord(value) ? value : {};
  return {
    tag: normalizedSearchText({
      allowEmpty: true,
      fallback: DEFAULT_DISCOVER_ROUTE_SEARCH.tag,
      maxBytes: MAX_DISCOVER_TAG_BYTES,
      value: search.tag,
    }),
    sort: discoverSort(search.sort),
  };
}

function parsePositiveIntegerRouteId(
  value: unknown,
  label: string,
  maximum: number,
): number {
  let parsed: number;
  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "string" && /^[1-9]\d*$/u.test(value)) {
    if (value.length > String(maximum).length) {
      throw new TypeError(`${label} is outside the supported range`);
    }
    parsed = Number(value);
  } else {
    throw new TypeError(`${label} must be a positive integer`);
  }

  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new TypeError(`${label} is outside the supported range`);
  }
  return parsed;
}

export function parseRadioSeriesIdParam(value: unknown): RadioSeriesId {
  const parsed = parsePositiveIntegerRouteId(
    value,
    "Radio series ID",
    MAX_RADIO_SHOW_ID,
  );
  if (!isRadioSeriesId(parsed)) {
    throw new TypeError("Radio series ID is not a supported series");
  }
  return parsed;
}

export function stringifyRadioSeriesIdParam(value: RadioSeriesId): string;
export function stringifyRadioSeriesIdParam(value: unknown): string {
  return String(parseRadioSeriesIdParam(value));
}

function isRadioSeriesId(value: number): value is RadioSeriesId {
  return BANDCAMP_RADIO_SERIES.some((series) => series.id === value);
}

function isRadioShowId(value: number): value is RadioShowId {
  return (
    Number.isSafeInteger(value) && value >= 1 && value <= MAX_RADIO_SHOW_ID
  );
}

export function parseRadioShowIdParam(value: unknown): RadioShowId {
  const parsed = parsePositiveIntegerRouteId(
    value,
    "Radio show ID",
    MAX_RADIO_SHOW_ID,
  );
  if (!isRadioShowId(parsed)) {
    throw new TypeError("Radio show ID is outside the supported range");
  }
  return parsed;
}

export function stringifyRadioShowIdParam(value: RadioShowId): string;
export function stringifyRadioShowIdParam(value: unknown): string {
  return String(parseRadioShowIdParam(value));
}

function isBoundedNonUrlIdentifier(
  value: unknown,
  maximumBytes: number,
): value is string {
  return !(
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumBytes ||
    value.trim() !== value ||
    CONTROL_CHARACTERS.test(value) ||
    ABSOLUTE_URL.test(value) ||
    value.startsWith("//") ||
    utf8ByteLength(value) > maximumBytes
  );
}

function isAlbumId(value: unknown): value is AlbumId {
  return isBoundedNonUrlIdentifier(value, MAX_SUBSONIC_ROUTE_ID_BYTES);
}

export function parseAlbumIdParam(value: unknown): AlbumId {
  if (!isAlbumId(value)) {
    throw new TypeError("Album ID must be a bounded non-URL identifier");
  }
  return value;
}

export function stringifyAlbumIdParam(value: AlbumId): string;
export function stringifyAlbumIdParam(value: unknown): string {
  return parseAlbumIdParam(value);
}

function isPlaylistId(value: unknown): value is PlaylistId {
  return isBoundedNonUrlIdentifier(value, MAX_SUBSONIC_ROUTE_ID_BYTES);
}

export function parsePlaylistIdParam(value: unknown): PlaylistId {
  if (!isPlaylistId(value)) {
    throw new TypeError("Playlist ID must be a bounded non-URL identifier");
  }
  return value;
}

export function stringifyPlaylistIdParam(value: PlaylistId): string;
export function stringifyPlaylistIdParam(value: unknown): string {
  return parsePlaylistIdParam(value);
}

const DISCOVER_RELEASE_ID_PREFIX = "discover:";

export function isDiscoverReleaseId(value: unknown): value is DiscoverReleaseId {
  if (
    !isBoundedNonUrlIdentifier(value, MAX_DISCOVER_RELEASE_ID_BYTES) ||
    !value.startsWith(DISCOVER_RELEASE_ID_PREFIX)
  ) {
    return false;
  }
  const remoteValue = value.slice(DISCOVER_RELEASE_ID_PREFIX.length);
  return remoteValue.length > 0 && remoteValue.trim() === remoteValue;
}

export function parseDiscoverReleaseIdParam(value: unknown): DiscoverReleaseId {
  if (!isDiscoverReleaseId(value)) {
    throw new TypeError(
      "Discover release ID must be a bounded discover: identifier",
    );
  }
  return value;
}

export function stringifyDiscoverReleaseIdParam(
  value: DiscoverReleaseId,
): string;
export function stringifyDiscoverReleaseIdParam(value: unknown): string {
  return parseDiscoverReleaseIdParam(value);
}

function isArtistKey(value: unknown): value is ArtistKey {
  return (
    isBoundedNonUrlIdentifier(value, MAX_ARTIST_KEY_BYTES) &&
    artistKey(value) === value
  );
}

export function parseArtistKeyParam(value: unknown): ArtistKey {
  if (!isArtistKey(value)) {
    throw new TypeError("Artist key must be canonical");
  }
  return value;
}

export function stringifyArtistKeyParam(value: ArtistKey): string;
export function stringifyArtistKeyParam(value: unknown): string {
  return parseArtistKeyParam(value);
}
