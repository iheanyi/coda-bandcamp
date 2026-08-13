import { fetchDailyArticle, paletteFor } from "@/lib";
import type {
  DailyArticle,
  DailyCategory,
  DailyEmbed,
  DailyTrackSource,
  Track,
} from "@/types";

export const DAILY_CATEGORIES: ReadonlyArray<{
  value: DailyCategory;
  label: string;
}> = [
  { value: "album-of-the-day", label: "Album of the Day" },
  { value: "features", label: "Features" },
  { value: "lists", label: "Lists" },
  { value: "big-ups", label: "Big Ups" },
  { value: "scene-report", label: "Scene Report" },
  { value: "essential-releases", label: "Essential Releases" },
];

const DAILY_CATEGORY_VALUES = new Set<DailyCategory>(
  DAILY_CATEGORIES.map(({ value }) => value),
);

export function isDailyCategory(value: unknown): value is DailyCategory {
  return (
    typeof value === "string" &&
    DAILY_CATEGORY_VALUES.has(value as DailyCategory)
  );
}

export function parseDailyCategory(value: unknown): DailyCategory {
  if (!isDailyCategory(value)) {
    throw new TypeError("Bandcamp Daily category is invalid");
  }
  return value;
}

export function parseDailyArticleSlug(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 160 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)
  ) {
    throw new TypeError("Bandcamp Daily article slug is invalid");
  }
  return value;
}

export function dailyCategoryLabel(category: DailyCategory): string {
  return (
    DAILY_CATEGORIES.find(({ value }) => value === category)?.label ?? category
  );
}

export function dailyTrackSource(
  article: DailyArticle,
  embed: DailyEmbed,
): DailyTrackSource {
  return {
    category: article.category,
    articleSlug: article.slug,
    articleTitle: article.title,
    articleUrl: article.articleUrl,
    itemUrl: embed.itemUrl,
    ...(embed.artistUrl ? { artistUrl: embed.artistUrl } : {}),
  };
}

export function dailyTracksFromEmbed(
  article: DailyArticle,
  embed: DailyEmbed,
): Track[] {
  const source = dailyTrackSource(article, embed);
  return embed.tracks.map((track) => ({
    ...track,
    dailySource: source,
    palette: paletteFor(track.albumId),
  }));
}

export async function refreshDailyTrack(track: Track): Promise<Track> {
  const source = track.dailySource;
  if (!source || !track.id.startsWith("daily:")) {
    throw new Error("This Bandcamp Daily track cannot be refreshed.");
  }
  const article = await fetchDailyArticle(source.category, source.articleSlug);
  for (const embed of article.embeds) {
    const refreshed = dailyTracksFromEmbed(article, embed).find(
      (candidate) => candidate.id === track.id,
    );
    if (refreshed) return refreshed;
  }
  throw new Error("This Bandcamp Daily preview is no longer available.");
}

export function formatDailyDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}
