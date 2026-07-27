import type { RadioSeries } from "./types";

export const BANDCAMP_RADIO_SERIES = [
  { id: 1, title: "Bandcamp Electronic", slug: "bandcamp-electronic" },
  { id: 2, title: "Bandcamp Selects", slug: "bandcamp-selects" },
  { id: 4, title: "The Game Show", slug: "the-game-show" },
  { id: 5, title: "The Hip Hop Show", slug: "the-hip-hop-show" },
  { id: 6, title: "The Indie Show", slug: "the-indie-show" },
  { id: 7, title: "The Metal Show", slug: "the-metal-show" },
] as const satisfies readonly RadioSeries[];

export function radioSeriesByTitle(title: string): RadioSeries | undefined {
  const normalizedTitle = title.trim().toLocaleLowerCase();
  return BANDCAMP_RADIO_SERIES.find(
    (series) => series.title.toLocaleLowerCase() === normalizedTitle,
  );
}

export function radioEpisodeUrl(showId: number): string {
  return `https://bandcamp.com/radio?show=${showId}`;
}
