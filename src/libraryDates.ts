import type { OwnDataValue } from "./ownData";
import type { Album, ItemDate } from "./types";

const BANDCAMP_DATE_PATTERN =
  /^(\d{1,2}) ([A-Za-z]{3}) (\d{4}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d+))? GMT$/i;
const ISO_DATE_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:(Z)|([+-])(\d{2}):(\d{2}))?)?$/i;

const MONTHS = new Map(
  [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
  ].map((month, index) => [month, index + 1]),
);
const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const BASE_TEXT_COLLATOR = new Intl.Collator("en-US", { sensitivity: "base" });
const EXACT_TEXT_COLLATOR = new Intl.Collator("en-US", { sensitivity: "variant" });

type LibraryDateSortKey = {
  timestampMilliseconds: number;
  fractionalRemainder: string;
};

function milliseconds(value: string | undefined): number {
  return Number((value ?? "").slice(0, 3).padEnd(3, "0"));
}

function fractionalRemainder(value: string | undefined): string {
  return (value ?? "").slice(3).replace(/0+$/, "");
}

function utcTimestamp(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
): number | undefined {
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return undefined;
  }

  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, millisecond);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second ||
    date.getUTCMilliseconds() !== millisecond
  ) {
    return undefined;
  }
  return date.getTime();
}

function parseLibraryDateSortKey(
  value: string | undefined,
): LibraryDateSortKey | undefined {
  const candidate = value?.trim();
  if (!candidate) return undefined;

  const bandcamp = BANDCAMP_DATE_PATTERN.exec(candidate);
  if (bandcamp) {
    const month = MONTHS.get(bandcamp[2].toLocaleLowerCase("en-US"));
    if (!month) return undefined;
    const timestampMilliseconds = utcTimestamp(
      Number(bandcamp[3]),
      month,
      Number(bandcamp[1]),
      Number(bandcamp[4]),
      Number(bandcamp[5]),
      Number(bandcamp[6]),
      milliseconds(bandcamp[7]),
    );
    return timestampMilliseconds === undefined
      ? undefined
      : {
          timestampMilliseconds,
          fractionalRemainder: fractionalRemainder(bandcamp[7]),
        };
  }

  const iso = ISO_DATE_PATTERN.exec(candidate);
  if (!iso) return undefined;
  const timestamp = utcTimestamp(
    Number(iso[1]),
    Number(iso[2]),
    Number(iso[3]),
    Number(iso[4] ?? 0),
    Number(iso[5] ?? 0),
    Number(iso[6] ?? 0),
    milliseconds(iso[7]),
  );
  if (timestamp === undefined) return undefined;

  const offsetHour = Number(iso[10] ?? 0);
  const offsetMinute = Number(iso[11] ?? 0);
  if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) {
    return undefined;
  }
  const offsetDirection = iso[9] === "-" ? -1 : 1;
  return {
    timestampMilliseconds:
      timestamp - offsetDirection * (offsetHour * 60 + offsetMinute) * 60_000,
    fractionalRemainder: fractionalRemainder(iso[7]),
  };
}

export function parseLibraryDate(value: string | undefined): number | undefined {
  return parseLibraryDateSortKey(value)?.timestampMilliseconds;
}

type AddedAlbum = Pick<Album, "addedAt" | "artist" | "id" | "title">;
type ReleaseAlbum = Pick<
  Album,
  | "artist"
  | "id"
  | "originalReleaseDate"
  | "releaseDate"
  | "title"
  | "year"
>;
const ADDED_DATE_CACHE = new WeakMap<
  AddedAlbum,
  { source: string | undefined; date: LibraryDateSortKey | undefined }
>();

function addedDateSortKey(album: AddedAlbum): LibraryDateSortKey | undefined {
  const cached = ADDED_DATE_CACHE.get(album);
  if (cached && cached.source === album.addedAt) return cached.date;
  const date = parseLibraryDateSortKey(album.addedAt);
  ADDED_DATE_CACHE.set(album, { source: album.addedAt, date });
  return date;
}

function compareText(left: string, right: string): number {
  return BASE_TEXT_COLLATOR.compare(left, right) || EXACT_TEXT_COLLATOR.compare(left, right);
}

function compareFractionalRemainders(left: string, right: string): number {
  const width = Math.max(left.length, right.length);
  const normalizedLeft = left.padEnd(width, "0");
  const normalizedRight = right.padEnd(width, "0");
  if (normalizedLeft === normalizedRight) return 0;
  return normalizedLeft > normalizedRight ? -1 : 1;
}

function compareAddedDateKeys(
  left: LibraryDateSortKey | undefined,
  right: LibraryDateSortKey | undefined,
): number {
  if (left !== undefined && right === undefined) return -1;
  if (left === undefined && right !== undefined) return 1;
  if (left === undefined || right === undefined) return 0;
  const newestFirst = right.timestampMilliseconds - left.timestampMilliseconds;
  return newestFirst || compareFractionalRemainders(
    left.fractionalRemainder,
    right.fractionalRemainder,
  );
}

function compareAlbumIdentity(left: AddedAlbum, right: AddedAlbum): number {
  return (
    compareText(left.artist, right.artist) ||
    compareText(left.title, right.title) ||
    compareText(left.id, right.id)
  );
}

export function compareAlbumsByNewestAdded(
  left: AddedAlbum,
  right: AddedAlbum,
): number {
  return (
    compareAddedDateKeys(
      addedDateSortKey(left),
      addedDateSortKey(right),
    ) || compareAlbumIdentity(left, right)
  );
}

export function sortAlbumsByNewestAdded<T extends AddedAlbum>(
  albums: readonly T[],
  tieBreaker?: (left: T, right: T) => number,
): T[] {
  const compareTie = tieBreaker ?? compareAlbumIdentity;
  return albums
    .map((album) => ({
      album,
      date: addedDateSortKey(album),
    }))
    .sort(
      (left, right) =>
        compareAddedDateKeys(left.date, right.date) ||
        compareTie(left.album, right.album),
    )
    .map(({ album }) => album);
}

function isValidItemDatePart(
  value: OwnDataValue,
  minimum: number,
  maximum: number,
): value is number | undefined {
  if (value === undefined) return true;
  const numericValue = Number(value);
  return (
    Object.is(value, numericValue) &&
    Number.isInteger(numericValue) &&
    numericValue >= minimum &&
    numericValue <= maximum
  );
}

export function isItemDate(value: OwnDataValue): value is ItemDate {
  if (!(value instanceof Object) || Array.isArray(value) || !("year" in value)) {
    return false;
  }
  const year = value.year;
  const month = "month" in value ? value.month : undefined;
  const day = "day" in value ? value.day : undefined;
  if (
    year === undefined ||
    !isValidItemDatePart(year, 1, 9_999) ||
    !isValidItemDatePart(month, 1, 12) ||
    !isValidItemDatePart(day, 1, 31) ||
    (day !== undefined && month === undefined)
  ) {
    return false;
  }
  if (month !== undefined && day !== undefined) {
    return utcTimestamp(year, month, day, 0, 0, 0, 0) !== undefined;
  }
  return true;
}

function itemDateSortValue(value: ItemDate | undefined): number | undefined {
  if (!isItemDate(value)) return undefined;
  return value.year * 10_000 + (value.month ?? 0) * 100 + (value.day ?? 0);
}

function releaseSortValue(album: ReleaseAlbum): number | undefined {
  return (
    itemDateSortValue(album.releaseDate) ??
    itemDateSortValue(album.originalReleaseDate) ??
    (album.year !== undefined &&
    Number.isInteger(album.year) &&
    album.year > 0 &&
    album.year <= 9_999
      ? album.year * 10_000
      : undefined)
  );
}

export function compareAlbumsByNewestRelease(
  left: ReleaseAlbum,
  right: ReleaseAlbum,
): number {
  const leftDate = releaseSortValue(left);
  const rightDate = releaseSortValue(right);
  if (leftDate !== undefined && rightDate === undefined) return -1;
  if (leftDate === undefined && rightDate !== undefined) return 1;
  if (leftDate !== undefined && rightDate !== undefined && leftDate !== rightDate) {
    return rightDate - leftDate;
  }
  return (
    compareText(left.artist, right.artist) ||
    compareText(left.title, right.title) ||
    compareText(left.id, right.id)
  );
}

export function sortAlbumsByNewestRelease<T extends ReleaseAlbum>(
  albums: readonly T[],
): T[] {
  return albums
    .map((album) => ({ album, date: releaseSortValue(album) }))
    .sort((left, right) => {
      if (left.date !== undefined && right.date === undefined) return -1;
      if (left.date === undefined && right.date !== undefined) return 1;
      if (
        left.date !== undefined &&
        right.date !== undefined &&
        left.date !== right.date
      ) {
        return right.date - left.date;
      }
      return compareAlbumIdentity(left.album, right.album);
    })
    .map(({ album }) => album);
}

export function formatItemDate(value: ItemDate | undefined): string | undefined {
  if (!isItemDate(value)) return undefined;
  if (value.month === undefined) return String(value.year);
  const month = MONTH_LABELS[value.month - 1];
  return value.day === undefined
    ? `${month} ${value.year}`
    : `${month} ${value.day}, ${value.year}`;
}

export function formatAlbumReleaseDate(album: ReleaseAlbum): string | undefined {
  return (
    formatItemDate(album.releaseDate) ??
    formatItemDate(album.originalReleaseDate) ??
    (album.year !== undefined &&
    Number.isInteger(album.year) &&
    album.year > 0 &&
    album.year <= 9_999
      ? String(album.year)
      : undefined)
  );
}
