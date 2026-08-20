import type { DiscoverFilters, DiscoverPage } from "../types";
import { requireDesktop } from "./desktop";
import {
  decodeNativeArray,
  decodeNativeBandcampUrl,
  decodeNativeBoolean,
  decodeNativeInteger,
  decodeNativeOptionalBandcampUrl,
  decodeNativeOptionalString,
  decodeNativeRecord,
  decodeNativeString,
  invokeNative,
  MAX_NATIVE_IDENTIFIER_BYTES,
  MAX_NATIVE_METADATA_BYTES,
  type NativeValue,
} from "./native";

const MAX_DISCOVER_RESULTS = 40;
const MAX_DISCOVER_CURSOR_BYTES = 2_048;

export function parseDiscoverRelease(
  value: NativeValue,
  context: string,
): DiscoverPage["results"][number] {
  const record = decodeNativeRecord(value, context);
  const release: DiscoverPage["results"][number] = {
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
    itemUrl: decodeNativeBandcampUrl(
      record.itemUrl,
      `${context}.itemUrl`,
    ),
  };
  const genre = decodeNativeOptionalString(
    record.genre,
    `${context}.genre`,
    MAX_NATIVE_METADATA_BYTES,
  );
  const location = decodeNativeOptionalString(
    record.location,
    `${context}.location`,
    MAX_NATIVE_METADATA_BYTES,
  );
  const artworkUrl = decodeNativeOptionalBandcampUrl(
    record.artworkUrl,
    `${context}.artworkUrl`,
  );
  if (genre !== undefined) release.genre = genre;
  if (location !== undefined) release.location = location;
  if (artworkUrl !== undefined) release.artworkUrl = artworkUrl;
  if (record.featuredTrack !== null && record.featuredTrack !== undefined) {
    const track = decodeNativeRecord(
      record.featuredTrack,
      `${context}.featuredTrack`,
    );
    release.featuredTrack = {
      id: decodeNativeString(
        track.id,
        `${context}.featuredTrack.id`,
        MAX_NATIVE_IDENTIFIER_BYTES,
      ),
      title: decodeNativeString(
        track.title,
        `${context}.featuredTrack.title`,
        MAX_NATIVE_METADATA_BYTES,
      ),
      duration: decodeNativeInteger(
        track.duration,
        `${context}.featuredTrack.duration`,
        7 * 24 * 60 * 60,
      ),
      streamUrl: decodeNativeBandcampUrl(
        track.streamUrl,
        `${context}.featuredTrack.streamUrl`,
      ),
    };
  }
  return release;
}

export function parseDiscoverPage(
  value: NativeValue,
  context: string,
): DiscoverPage {
  const record = decodeNativeRecord(value, context);
  const page: DiscoverPage = {
    results: decodeNativeArray(
      record.results,
      `${context}.results`,
      MAX_DISCOVER_RESULTS,
      parseDiscoverRelease,
    ),
    resultCount: decodeNativeInteger(
      record.resultCount,
      `${context}.resultCount`,
    ),
    hasMore: decodeNativeBoolean(record.hasMore, `${context}.hasMore`),
  };
  const cursor = decodeNativeOptionalString(
    record.cursor,
    `${context}.cursor`,
    MAX_DISCOVER_CURSOR_BYTES,
    true,
  );
  if (cursor !== undefined) page.cursor = cursor;
  return page;
}

export async function fetchDiscover(
  filters: DiscoverFilters,
  cursor = "*",
): Promise<DiscoverPage> {
  requireDesktop("Discover");
  return parseDiscoverPage(
    await invokeNative("discover", {
      input: {
        tag: filters.tag,
        sort: filters.sort,
        cursor,
      },
    }),
    "discover",
  );
}
