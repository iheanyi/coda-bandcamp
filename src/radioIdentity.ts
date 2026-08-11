import { BANDCAMP_RADIO_SERIES, radioSeriesByTitle } from "@/radioSeries";
import type { RadioSeries, RadioShow, RadioShowSummary } from "@/types";

export const BANDCAMP_RADIO_PROVIDER = "Bandcamp Radio";

export type RadioShowIdentity = Readonly<{
  provider: typeof BANDCAMP_RADIO_PROVIDER;
  episodeTitle: string;
  seriesTitle?: string;
}>;

// Mirrors the native archive correction so existing device-local favorites
// gain the same identity without waiting for a fresh network response.
const RADIO_SHOW_SERIES_OVERRIDES = new Map<number, number>([[981, 5]]);

function detailSeriesTitle(
  show: RadioShowSummary | RadioShow,
): string | undefined {
  if (!("title" in show)) return undefined;
  const title = show.title.trim();
  return title || undefined;
}

export function radioSeriesForShow(
  show: RadioShowSummary | RadioShow,
): RadioSeries | undefined {
  if (show.series) return show.series;
  const overrideSeriesId = RADIO_SHOW_SERIES_OVERRIDES.get(show.id);
  const override = BANDCAMP_RADIO_SERIES.find(
    (series) => series.id === overrideSeriesId,
  );
  if (override) return override;
  const detailTitle = detailSeriesTitle(show);
  return detailTitle ? radioSeriesByTitle(detailTitle) : undefined;
}

export function radioShowIdentity(
  show: RadioShowSummary | RadioShow,
): RadioShowIdentity {
  const series = radioSeriesForShow(show);
  return {
    provider: BANDCAMP_RADIO_PROVIDER,
    episodeTitle: show.subtitle,
    seriesTitle: series?.title ?? detailSeriesTitle(show),
  };
}
