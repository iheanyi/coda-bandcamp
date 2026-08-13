export const DAILY_CATEGORY_GROUPS = [
  {
    id: "best-of",
    label: "Best of",
    items: [
      { value: "best-of-2026", label: "Best of 2026" },
      { value: "best-of-2025", label: "Best of 2025" },
      { value: "best-of-2024", label: "Best of 2024" },
      { value: "best-of-2023", label: "Best of 2023" },
      { value: "best-of-2022", label: "Best of 2022" },
      { value: "best-of-2021", label: "Best of 2021" },
      { value: "best-of-2020", label: "Best of 2020" },
      { value: "best-of-2019", label: "Best of 2019" },
      { value: "best-of-2018", label: "Best of 2018" },
      { value: "best-of-2017", label: "Best of 2017" },
      { value: "best-of-2016", label: "Best of 2016" },
      { value: "best-ambient", label: "Best Ambient" },
      { value: "best-beat-tapes", label: "Best Beat Tapes" },
      { value: "best-dance-12s", label: "Best Dance 12”s" },
      { value: "best-electronic", label: "Best Electronic" },
      { value: "best-experimental", label: "Best Experimental" },
      {
        value: "best-contemporary-classical",
        label: "Best Contemporary Classical",
      },
      { value: "best-hip-hop", label: "Best Hip-Hop" },
      { value: "best-jazz", label: "Best Jazz" },
      { value: "best-metal", label: "Best Metal" },
      { value: "best-punk", label: "Best Punk" },
      { value: "best-reissues", label: "Best Reissues" },
      { value: "best-soul", label: "Best Soul" },
      { value: "best-folk", label: "Best Folk" },
      { value: "best-field-recordings", label: "Best Field Recordings" },
      { value: "best-club-music", label: "Best Club Music" },
      { value: "best-country", label: "Best Country" },
    ],
  },
  {
    id: "franchises",
    label: "Franchises",
    items: [
      { value: "lists", label: "Lists" },
      { value: "features", label: "Features" },
      { value: "album-of-the-day", label: "Album of the Day" },
      { value: "acid-test", label: "Acid Test" },
      { value: "bandcamp-navigator", label: "Bandcamp Navigator" },
      { value: "big-ups", label: "Big Ups" },
      { value: "certified", label: "Certified" },
      { value: "gallery", label: "Gallery" },
      { value: "hidden-gems", label: "Hidden Gems" },
      { value: "high-scores", label: "High Scores" },
      { value: "label-profile", label: "Label Profile" },
      { value: "lifetime-achievement", label: "Lifetime Achievement" },
      { value: "resonance", label: "Resonance" },
      { value: "scene-report", label: "Scene Report" },
      { value: "essential-releases", label: "Essential Releases" },
      { value: "shortlist", label: "Shortlist" },
      { value: "the-merch-table", label: "The Merch Table" },
    ],
  },
  {
    id: "genres",
    label: "Genres",
    items: [
      { value: "genre-alternative", label: "Alternative" },
      { value: "genre-pop", label: "Pop" },
      { value: "genre-world", label: "World" },
      { value: "genre-folk", label: "Folk" },
      { value: "genre-hip-hop-rap", label: "Hip-Hop/Rap" },
      { value: "genre-classical", label: "Classical" },
      { value: "genre-experimental", label: "Experimental" },
      { value: "genre-electronic", label: "Electronic" },
      { value: "genre-rock", label: "Rock" },
      { value: "genre-r-b-soul", label: "R&B/Soul" },
      { value: "genre-comedy", label: "Comedy" },
      { value: "genre-country", label: "Country" },
      { value: "genre-soundtrack", label: "Soundtrack" },
      { value: "genre-metal", label: "Metal" },
      { value: "genre-jazz", label: "Jazz" },
      { value: "genre-punk", label: "Punk" },
      { value: "genre-reggae", label: "Reggae" },
      { value: "genre-funk", label: "Funk" },
      { value: "genre-ambient", label: "Ambient" },
      { value: "genre-acoustic", label: "Acoustic" },
      { value: "genre-blues", label: "Blues" },
      { value: "genre-latin", label: "Latin" },
      { value: "genre-devotional", label: "Devotional" },
      { value: "genre-spoken-word", label: "Spoken Word" },
      { value: "genre-podcasts", label: "Podcasts" },
    ],
  },
] as const;

export type DailyCategory =
  (typeof DAILY_CATEGORY_GROUPS)[number]["items"][number]["value"];

export type DailyCategoryItem = Readonly<{
  label: string;
  value: DailyCategory;
}>;

export const DAILY_CATEGORIES: readonly DailyCategoryItem[] =
  DAILY_CATEGORY_GROUPS.flatMap(
    ({ items }) => [...items] as DailyCategoryItem[],
);
