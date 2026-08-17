import type { RadioShow, RadioShowsPage } from "../types";
import { isDesktop } from "./desktop";
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
  type NativeValue,
} from "./native";

const MAX_RADIO_SHOWS = 1_000;
const MAX_RADIO_SHOW_ID = 1_000_000;
const MAX_RADIO_CURSOR_BYTES = 128;
const MAX_RADIO_TEXT_BYTES = 4_096;
const MAX_RADIO_CHAPTERS = 256;
const MAX_RADIO_DURATION_SECONDS = 24 * 60 * 60;

export function parseRadioSeries(
  value: NativeValue,
  context: string,
): NonNullable<RadioShow["series"]> {
  const record = decodeNativeRecord(value, context);
  return {
    id: decodeNativeInteger(
      record.id,
      `${context}.id`,
      MAX_RADIO_SHOW_ID,
      1,
    ),
    title: decodeNativeString(
      record.title,
      `${context}.title`,
      MAX_RADIO_TEXT_BYTES,
    ),
    slug: decodeNativeString(
      record.slug,
      `${context}.slug`,
      MAX_NATIVE_IDENTIFIER_BYTES,
    ),
  };
}

export function parseRadioShowSummary(
  value: NativeValue,
  context: string,
): RadioShowsPage["results"][number] {
  const record = decodeNativeRecord(value, context);
  const show: RadioShowsPage["results"][number] = {
    id: decodeNativeInteger(
      record.id,
      `${context}.id`,
      MAX_RADIO_SHOW_ID,
      1,
    ),
    subtitle: decodeNativeString(
      record.subtitle,
      `${context}.subtitle`,
      MAX_RADIO_TEXT_BYTES,
    ),
    description: decodeNativeString(
      record.description,
      `${context}.description`,
      MAX_RADIO_TEXT_BYTES,
    ),
    publishedAt: decodeNativeString(
      record.publishedAt,
      `${context}.publishedAt`,
      MAX_RADIO_TEXT_BYTES,
    ),
  };
  const artworkUrl = decodeNativeOptionalBandcampUrl(
    record.artworkUrl,
    `${context}.artworkUrl`,
  );
  if (artworkUrl !== undefined) show.artworkUrl = artworkUrl;
  if (record.series !== null && record.series !== undefined) {
    show.series = parseRadioSeries(record.series, `${context}.series`);
  }
  return show;
}

export function parseRadioShowsPage(
  value: NativeValue,
  context: string,
): RadioShowsPage {
  const record = decodeNativeRecord(value, context);
  const page: RadioShowsPage = {
    results: decodeNativeArray(
      record.results,
      `${context}.results`,
      MAX_RADIO_SHOWS,
      parseRadioShowSummary,
    ),
    hasMore: decodeNativeBoolean(record.hasMore, `${context}.hasMore`),
  };
  const cursor = decodeNativeOptionalString(
    record.cursor,
    `${context}.cursor`,
    MAX_RADIO_CURSOR_BYTES,
    true,
  );
  if (cursor !== undefined) page.cursor = cursor;
  return page;
}

export function parseRadioShow(value: NativeValue, context: string): RadioShow {
  const record = decodeNativeRecord(value, context);
  const summary = parseRadioShowSummary(record, context);
  const chapters = decodeNativeArray(
    record.chapters,
    `${context}.chapters`,
    MAX_RADIO_CHAPTERS,
    (chapterValue, chapterContext) => {
      const chapter = decodeNativeRecord(chapterValue, chapterContext);
      const parsed: RadioShow["chapters"][number] = {
        title: decodeNativeString(
          chapter.title,
          `${chapterContext}.title`,
          MAX_RADIO_TEXT_BYTES,
        ),
        artist: decodeNativeString(
          chapter.artist,
          `${chapterContext}.artist`,
          MAX_RADIO_TEXT_BYTES,
        ),
        timecode: decodeNativeInteger(
          chapter.timecode,
          `${chapterContext}.timecode`,
          MAX_RADIO_DURATION_SECONDS,
        ),
      };
      const album = decodeNativeOptionalString(
        chapter.album,
        `${chapterContext}.album`,
        MAX_RADIO_TEXT_BYTES,
        true,
      );
      const itemUrl = decodeNativeOptionalBandcampUrl(
        chapter.itemUrl,
        `${chapterContext}.itemUrl`,
      );
      const artistUrl = decodeNativeOptionalBandcampUrl(
        chapter.artistUrl,
        `${chapterContext}.artistUrl`,
      );
      const albumUrl = decodeNativeOptionalBandcampUrl(
        chapter.albumUrl,
        `${chapterContext}.albumUrl`,
      );
      const artworkUrl = decodeNativeOptionalBandcampUrl(
        chapter.artworkUrl,
        `${chapterContext}.artworkUrl`,
      );
      if (album !== undefined) parsed.album = album;
      if (itemUrl !== undefined) parsed.itemUrl = itemUrl;
      if (artistUrl !== undefined) parsed.artistUrl = artistUrl;
      if (albumUrl !== undefined) parsed.albumUrl = albumUrl;
      if (artworkUrl !== undefined) parsed.artworkUrl = artworkUrl;
      return parsed;
    },
  );
  return {
    ...summary,
    title: decodeNativeString(
      record.title,
      `${context}.title`,
      MAX_RADIO_TEXT_BYTES,
    ),
    duration: decodeNativeInteger(
      record.duration,
      `${context}.duration`,
      MAX_RADIO_DURATION_SECONDS,
    ),
    streamUrl: decodeNativeBandcampUrl(
      record.streamUrl,
      `${context}.streamUrl`,
    ),
    chapters,
  };
}

export async function fetchRadioShows({
  seriesId,
  cursor,
}: {
  seriesId?: number;
  cursor?: string;
} = {}): Promise<RadioShowsPage> {
  if (!isDesktop()) {
    throw new Error("Bandcamp Radio is available in the Coda desktop app.");
  }
  return parseRadioShowsPage(
    await invokeNative("radio_shows", { seriesId, cursor }),
    "radio_shows",
  );
}

export async function fetchRadioShow(showId: number): Promise<RadioShow> {
  if (!isDesktop()) {
    throw new Error("Bandcamp Radio is available in the Coda desktop app.");
  }
  return parseRadioShow(
    await invokeNative("radio_show", { showId }),
    "radio_show",
  );
}
