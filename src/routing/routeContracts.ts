import { artistKey, type LibraryBrowseMode } from "@/libraryBrowse";
import { BANDCAMP_RADIO_SERIES } from "@/radioSeries";
import { isDailyArticleSection, isDailyCategory } from "@/daily";
import type {
  DailyCategory,
  DiscoverFilters,
  DiscoverSort,
  SortMode,
} from "@/types";

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
export type DailyRouteSearch = Readonly<{
  articleSection?: string;
  category: DailyCategory;
}>;

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

export const DEFAULT_DAILY_ROUTE_SEARCH: DailyRouteSearch = Object.freeze({
  category: "album-of-the-day",
});

const ABSOLUTE_URL = /^[a-z][a-z\d+.-]*:\/\//iu;

function isPrimitiveString<Value>(value: Value): value is Value & string {
  return (
    Object.prototype.toString.call(value) === "[object String]" &&
    value === String(value)
  );
}

function isPrimitiveNumber<Value>(value: Value): value is Value & number {
  return (
    Object.prototype.toString.call(value) === "[object Number]" &&
    value === Number(value)
  );
}

function hasPlainObjectTag<Value>(value: Value): value is Value & object {
  try {
    return Object.prototype.toString.call(value) === "[object Object]";
  } catch {
    return false;
  }
}

function isPlainRouteSearch<Value>(value: Value): value is Value & object {
  if (!hasPlainObjectTag(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
    ) {
      return true;
    }
  }
  return false;
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

function normalizedSearchText<Value>({
  allowEmpty,
  fallback,
  maxBytes,
  value,
}: Readonly<{
  allowEmpty: boolean;
  fallback: string;
  maxBytes: number;
  value: Value;
}>): string {
  if (
    !isPrimitiveString(value) ||
    value.length > maxBytes ||
    containsControlCharacter(value)
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

function collectionSort(value?: string): SortMode {
  switch (value) {
    case "recent":
      return "recent";
    case "artist":
      return "artist";
    case "title":
      return "title";
    case "year":
      return "year";
    default:
      return DEFAULT_COLLECTION_ROUTE_SEARCH.sort;
  }
}

function collectionMode(value?: string): LibraryBrowseMode {
  switch (value) {
    case "releases":
      return "releases";
    case "artists":
      return "artists";
    case "albums":
      return "albums";
    case "singles":
      return "singles";
    default:
      return DEFAULT_COLLECTION_ROUTE_SEARCH.mode;
  }
}

function discoverSort(value?: string): DiscoverSort {
  switch (value) {
    case "top":
      return "top";
    case "new":
      return "new";
    default:
      return DEFAULT_DISCOVER_ROUTE_SEARCH.sort;
  }
}

export function validateDailySearch<Value>(value: Value): DailyRouteSearch {
  const input = isPlainRouteSearch(value) ? value : undefined;
  const categoryCandidate =
    input && "category" in input ? input.category : undefined;
  const category = isDailyCategory(categoryCandidate)
    ? categoryCandidate
    : DEFAULT_DAILY_ROUTE_SEARCH.category;
  const articleSection =
    input && "articleSection" in input ? input.articleSection : undefined;
  if (isDailyArticleSection(articleSection)) {
    return { articleSection, category };
  }
  return { category };
}

export function validateCollectionSearch<Value>(
  value: Value,
): CollectionRouteSearch {
  const input = isPlainRouteSearch(value) ? value : undefined;
  const q = input && "q" in input ? input.q : undefined;
  const genreValue = input && "genre" in input ? input.genre : undefined;
  const sort = input && "sort" in input ? input.sort : undefined;
  const mode = input && "mode" in input ? input.mode : undefined;
  const genre = normalizedSearchText({
    allowEmpty: false,
    fallback: DEFAULT_COLLECTION_ROUTE_SEARCH.genre,
    maxBytes: MAX_ROUTE_SEARCH_TEXT_BYTES,
    value: genreValue,
  });

  return {
    q: normalizedSearchText({
      allowEmpty: true,
      fallback: DEFAULT_COLLECTION_ROUTE_SEARCH.q,
      maxBytes: MAX_ROUTE_SEARCH_TEXT_BYTES,
      value: q,
    }),
    genre: genre.toLocaleLowerCase("en-US") === "all" ? "All" : genre,
    sort: isPrimitiveString(sort) ? collectionSort(sort) : collectionSort(),
    mode: isPrimitiveString(mode) ? collectionMode(mode) : collectionMode(),
  };
}

export function validateDiscoverSearch<Value>(
  value: Value,
): DiscoverRouteSearch {
  const input = isPlainRouteSearch(value) ? value : undefined;
  const tag = input && "tag" in input ? input.tag : undefined;
  const sort = input && "sort" in input ? input.sort : undefined;
  return {
    tag: normalizedSearchText({
      allowEmpty: true,
      fallback: DEFAULT_DISCOVER_ROUTE_SEARCH.tag,
      maxBytes: MAX_DISCOVER_TAG_BYTES,
      value: tag,
    }),
    sort: isPrimitiveString(sort) ? discoverSort(sort) : discoverSort(),
  };
}

export function parseRouteSearchAlbumId<Value>(
  value: Value,
): AlbumId | undefined {
  const input = isPlainRouteSearch(value) ? value : undefined;
  const candidate = input && "albumId" in input ? input.albumId : undefined;
  try {
    return parseAlbumIdParam(candidate);
  } catch {
    return undefined;
  }
}

function parsePositiveIntegerRouteId<Value>(
  value: Value,
  label: string,
  maximum: number,
): number {
  let parsed: number;
  if (isPrimitiveNumber(value)) {
    parsed = value;
  } else if (isPrimitiveString(value) && /^[1-9]\d*$/u.test(value)) {
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

export function parseRadioSeriesIdParam<Value>(value: Value): RadioSeriesId {
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
export function stringifyRadioSeriesIdParam<Value>(value: Value): string {
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

export function parseRadioShowIdParam<Value>(value: Value): RadioShowId {
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
export function stringifyRadioShowIdParam<Value>(value: Value): string {
  return String(parseRadioShowIdParam(value));
}

function isBoundedNonUrlIdentifier<Value>(
  value: Value,
  maximumBytes: number,
): value is Value & string {
  return !(
    !isPrimitiveString(value) ||
    value.length === 0 ||
    value.length > maximumBytes ||
    value.trim() !== value ||
    containsControlCharacter(value) ||
    ABSOLUTE_URL.test(value) ||
    value.startsWith("//") ||
    utf8ByteLength(value) > maximumBytes
  );
}

function isAlbumId<Value>(value: Value): value is Value & AlbumId {
  return isBoundedNonUrlIdentifier(value, MAX_SUBSONIC_ROUTE_ID_BYTES);
}

export function parseAlbumIdParam<Value>(value: Value): AlbumId {
  if (!isAlbumId(value)) {
    throw new TypeError("Album ID must be a bounded non-URL identifier");
  }
  return value;
}

export function stringifyAlbumIdParam(value: AlbumId): string;
export function stringifyAlbumIdParam<Value>(value: Value): string {
  return parseAlbumIdParam(value);
}

function isPlaylistId<Value>(value: Value): value is Value & PlaylistId {
  return isBoundedNonUrlIdentifier(value, MAX_SUBSONIC_ROUTE_ID_BYTES);
}

export function parsePlaylistIdParam<Value>(value: Value): PlaylistId {
  if (!isPlaylistId(value)) {
    throw new TypeError("Playlist ID must be a bounded non-URL identifier");
  }
  return value;
}

export function stringifyPlaylistIdParam(value: PlaylistId): string;
export function stringifyPlaylistIdParam<Value>(value: Value): string {
  return parsePlaylistIdParam(value);
}

const DISCOVER_RELEASE_ID_PREFIX = "discover:";

export function isDiscoverReleaseId<Value>(
  value: Value,
): value is Value & DiscoverReleaseId {
  if (
    !isBoundedNonUrlIdentifier(value, MAX_DISCOVER_RELEASE_ID_BYTES) ||
    !value.startsWith(DISCOVER_RELEASE_ID_PREFIX)
  ) {
    return false;
  }
  const remoteValue = value.slice(DISCOVER_RELEASE_ID_PREFIX.length);
  return remoteValue.length > 0 && remoteValue.trim() === remoteValue;
}

export function parseDiscoverReleaseIdParam<Value>(
  value: Value,
): DiscoverReleaseId {
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
export function stringifyDiscoverReleaseIdParam<Value>(value: Value): string {
  return parseDiscoverReleaseIdParam(value);
}

function isArtistKey<Value>(value: Value): value is Value & ArtistKey {
  return (
    isBoundedNonUrlIdentifier(value, MAX_ARTIST_KEY_BYTES) &&
    artistKey(value) === value
  );
}

export function parseArtistKeyParam<Value>(value: Value): ArtistKey {
  if (!isArtistKey(value)) {
    throw new TypeError("Artist key must be canonical");
  }
  return value;
}

export function stringifyArtistKeyParam(value: ArtistKey): string;
export function stringifyArtistKeyParam<Value>(value: Value): string {
  return parseArtistKeyParam(value);
}
