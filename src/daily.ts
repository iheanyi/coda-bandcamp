import { fetchDailyArticle, paletteFor } from "@/lib";
import { DAILY_CATEGORIES } from "@/dailyCatalog";
export { DAILY_CATEGORIES, DAILY_CATEGORY_GROUPS } from "@/dailyCatalog";
import type {
  DailyArticle,
  DailyCategory,
  DailyEmbed,
  DailyTrackSource,
  Track,
} from "@/types";

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

export function parseDailyArticleSection(value: unknown): string {
  if (!isDailyArticleSection(value)) {
    throw new TypeError("Bandcamp Daily article section is invalid");
  }
  return value;
}

export function isDailyArticleSection(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 96 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)
  );
}

export function dailyCategoryLabel(category: DailyCategory): string {
  return (
    DAILY_CATEGORIES.find(({ value }) => value === category)?.label ?? category
  );
}

export function dailyArticleSectionLabel(articleSection: string): string {
  const known = DAILY_CATEGORIES.find(
    ({ value }) => value === articleSection,
  )?.label;
  if (known) return known;
  return articleSection
    .split("-")
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

export function dailyTrackSource(
  article: DailyArticle,
  embed: DailyEmbed,
): DailyTrackSource {
  return {
    articleSection: article.articleSection,
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
  const article = await fetchDailyArticle(
    source.articleSection,
    source.articleSlug,
  );
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
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  const date = dateOnly
    ? new Date(
        Date.UTC(
          Number(dateOnly[1]),
          Number(dateOnly[2]) - 1,
          Number(dateOnly[3]),
        ),
      )
    : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(dateOnly ? { timeZone: "UTC" } : {}),
  }).format(date);
}

function dailyPublishedAtTimestamp(value: string | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
}

export function dailyArticlesNewestFirst(
  articles: readonly import("@/types").DailyArticleSummary[],
): import("@/types").DailyArticleSummary[] {
  const seen = new Set<string>();
  return articles
    .filter((article) => {
      if (seen.has(article.id)) return false;
      seen.add(article.id);
      return true;
    })
    .map((article, index) => ({ article, index }))
    .sort((left, right) => {
      const byDate =
        dailyPublishedAtTimestamp(right.article.publishedAt) -
        dailyPublishedAtTimestamp(left.article.publishedAt);
      return byDate || left.index - right.index;
    })
    .map(({ article }) => article);
}
