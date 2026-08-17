import type {
  DailyArticle,
  DailyArticleSummary,
  DailyArticlesPage,
  DailyCategory,
  DailyEmbed,
  DailyTrack,
} from "../types";
import { isDesktop } from "./desktop";
import {
  decodeNativeArray,
  decodeNativeBandcampUrl,
  decodeNativeBoolean,
  decodeNativeInteger,
  decodeNativeOptionalBandcampUrl,
  decodeNativeOptionalInteger,
  decodeNativeOptionalString,
  decodeNativeRecord,
  decodeNativeString,
  invokeNative,
  invalidNativeResponse,
  MAX_NATIVE_IDENTIFIER_BYTES,
  MAX_NATIVE_METADATA_BYTES,
  type NativeValue,
} from "./native";

const MAX_DAILY_ARTICLES_PER_PAGE = 30;
const MAX_DAILY_EMBEDS = 64;
const MAX_DAILY_TRACKS_PER_EMBED = 256;
const MAX_DAILY_TRACKS_TOTAL = 512;
const MAX_DAILY_PAGE = 10_000;
const MAX_DAILY_ARTICLE_SECTION_BYTES = 96;
const MAX_DAILY_SLUG_BYTES = 160;
const MAX_DAILY_DESCRIPTION_BYTES = 4_096;
const MAX_TRACK_NUMBER = 100_000;
const MAX_MEDIA_SECONDS = 7 * 24 * 60 * 60;

function parseDailyPathSegment(
  value: NativeValue,
  context: string,
  maximumBytes: number,
): string {
  const segment = decodeNativeString(value, context, maximumBytes);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(segment)) {
    return invalidNativeResponse(context, "a Bandcamp Daily path segment");
  }
  return segment;
}

function parseNativeDailyArticleSummary(
  value: NativeValue,
  context: string,
): DailyArticleSummary {
  const record = decodeNativeRecord(value, context);
  const summary: DailyArticleSummary = {
    id: decodeNativeString(
      record.id,
      `${context}.id`,
      MAX_NATIVE_IDENTIFIER_BYTES,
    ),
    articleSection: parseDailyPathSegment(
      record.articleSection,
      `${context}.articleSection`,
      MAX_DAILY_ARTICLE_SECTION_BYTES,
    ),
    slug: parseDailyPathSegment(
      record.slug,
      `${context}.slug`,
      MAX_DAILY_SLUG_BYTES,
    ),
    title: decodeNativeString(
      record.title,
      `${context}.title`,
      MAX_NATIVE_METADATA_BYTES,
    ),
    articleUrl: decodeNativeBandcampUrl(
      record.articleUrl,
      `${context}.articleUrl`,
    ),
  };
  const publishedAt = decodeNativeOptionalString(
    record.publishedAt,
    `${context}.publishedAt`,
    MAX_NATIVE_METADATA_BYTES,
    true,
  );
  const artworkUrl = decodeNativeOptionalBandcampUrl(
    record.artworkUrl,
    `${context}.artworkUrl`,
  );
  if (publishedAt !== undefined) summary.publishedAt = publishedAt;
  if (artworkUrl !== undefined) summary.artworkUrl = artworkUrl;
  return summary;
}

function parseNativeDailyTrack(
  value: NativeValue,
  context: string,
): DailyTrack {
  const record = decodeNativeRecord(value, context);
  const track: DailyTrack = {
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
    ),
    albumId: decodeNativeString(
      record.albumId,
      `${context}.albumId`,
      MAX_NATIVE_IDENTIFIER_BYTES,
    ),
    duration: decodeNativeInteger(
      record.duration,
      `${context}.duration`,
      MAX_MEDIA_SECONDS,
    ),
    track: decodeNativeInteger(
      record.track,
      `${context}.track`,
      MAX_TRACK_NUMBER,
      1,
    ),
    streamUrl: decodeNativeBandcampUrl(
      record.streamUrl,
      `${context}.streamUrl`,
    ),
  };
  const artworkUrl = decodeNativeOptionalBandcampUrl(
    record.artworkUrl,
    `${context}.artworkUrl`,
  );
  if (artworkUrl !== undefined) track.artworkUrl = artworkUrl;
  return track;
}

function parseNativeDailyEmbed(
  value: NativeValue,
  context: string,
): DailyEmbed {
  const record = decodeNativeRecord(value, context);
  const embed: DailyEmbed = {
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
    tracks: decodeNativeArray(
      record.tracks,
      `${context}.tracks`,
      MAX_DAILY_TRACKS_PER_EMBED,
      parseNativeDailyTrack,
    ),
  };
  const artistUrl = decodeNativeOptionalBandcampUrl(
    record.artistUrl,
    `${context}.artistUrl`,
  );
  const artworkUrl = decodeNativeOptionalBandcampUrl(
    record.artworkUrl,
    `${context}.artworkUrl`,
  );
  const location = decodeNativeOptionalString(
    record.location,
    `${context}.location`,
    MAX_NATIVE_METADATA_BYTES,
  );
  const featuredTrackNumber = decodeNativeOptionalInteger(
    record.featuredTrackNumber,
    `${context}.featuredTrackNumber`,
    MAX_TRACK_NUMBER,
    1,
  );
  if (artistUrl !== undefined) embed.artistUrl = artistUrl;
  if (artworkUrl !== undefined) embed.artworkUrl = artworkUrl;
  if (location !== undefined) embed.location = location;
  if (featuredTrackNumber !== undefined) {
    embed.featuredTrackNumber = featuredTrackNumber;
  }
  return embed;
}

export function parseNativeDailyArticlesPage(
  value: NativeValue,
  context = "daily_articles",
): DailyArticlesPage {
  const record = decodeNativeRecord(value, context);
  return {
    results: decodeNativeArray(
      record.results,
      `${context}.results`,
      MAX_DAILY_ARTICLES_PER_PAGE,
      parseNativeDailyArticleSummary,
    ),
    page: decodeNativeInteger(
      record.page,
      `${context}.page`,
      MAX_DAILY_PAGE,
      1,
    ),
    hasMore: decodeNativeBoolean(record.hasMore, `${context}.hasMore`),
  };
}

export function parseNativeDailyArticle(
  value: NativeValue,
  context = "daily_article",
): DailyArticle {
  const record = decodeNativeRecord(value, context);
  const embeds = decodeNativeArray(
    record.embeds,
    `${context}.embeds`,
    MAX_DAILY_EMBEDS,
    parseNativeDailyEmbed,
  );
  const trackCount = embeds.reduce(
    (total, embed) => total + embed.tracks.length,
    0,
  );
  if (trackCount > MAX_DAILY_TRACKS_TOTAL) {
    return invalidNativeResponse(
      `${context}.embeds`,
      `at most ${MAX_DAILY_TRACKS_TOTAL} tracks in total`,
    );
  }
  const article: DailyArticle = {
    ...parseNativeDailyArticleSummary(record, context),
    embeds,
  };
  const description = decodeNativeOptionalString(
    record.description,
    `${context}.description`,
    MAX_DAILY_DESCRIPTION_BYTES,
  );
  const author = decodeNativeOptionalString(
    record.author,
    `${context}.author`,
    MAX_NATIVE_METADATA_BYTES,
  );
  if (description !== undefined) article.description = description;
  if (author !== undefined) article.author = author;
  return article;
}

export async function fetchDailyArticles(
  section: DailyCategory,
  page = 1,
): Promise<DailyArticlesPage> {
  if (!isDesktop()) {
    throw new Error("Bandcamp Daily is available in the Coda desktop app.");
  }
  return parseNativeDailyArticlesPage(
    await invokeNative("daily_articles", { page, section }),
  );
}

export async function fetchDailyArticle(
  articleSection: string,
  slug: string,
): Promise<DailyArticle> {
  if (!isDesktop()) {
    throw new Error("Bandcamp Daily is available in the Coda desktop app.");
  }
  return parseNativeDailyArticle(
    await invokeNative("daily_article", { articleSection, slug }),
  );
}
