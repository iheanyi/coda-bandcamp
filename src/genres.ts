const PREFERRED_GENRE_NAMES = new Map<string, string>([
  ["r&b/soul", "R&B/Soul"],
  ["r-b-soul", "R&B/Soul"],
  ["hip-hop/rap", "Hip-Hop/Rap"],
  ["hip hop/rap", "Hip-Hop/Rap"],
  ["hip-hop-rap", "Hip-Hop/Rap"],
  ["hip-hop", "Hip-Hop"],
  ["hip hop", "Hip-Hop"],
  ["spoken-word", "Spoken Word"],
  ["idm", "IDM"],
  ["edm", "EDM"],
  ["dnb", "DnB"],
  ["lo-fi", "Lo-Fi"],
  ["r&b", "R&B"],
]);

export const DISCOVER_GENRES = [
  "electronic",
  "rock",
  "metal",
  "alternative",
  "hip-hop-rap",
  "experimental",
  "punk",
  "folk",
  "pop",
  "ambient",
  "soundtrack",
  "world",
  "jazz",
  "acoustic",
  "funk",
  "r-b-soul",
  "devotional",
  "classical",
  "reggae",
  "podcasts",
  "country",
  "spoken-word",
  "comedy",
  "blues",
  "kids",
  "audiobooks",
  "latin",
] as const;

export function genreKey(value?: string): string {
  return value?.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US") ?? "";
}

export function normalizeGenre(value?: string): string | undefined {
  const key = genreKey(value);
  if (!key) return undefined;
  const preferred = PREFERRED_GENRE_NAMES.get(key);
  if (preferred) return preferred;
  return key.replace(/(^|[\s/])\p{L}/gu, (letter) => letter.toLocaleUpperCase("en-US"));
}

export function summarizeGenres(
  albums: ReadonlyArray<{ genre?: string }>,
  featuredLimit = 5,
) {
  const counts = new Map<string, { label: string; count: number }>();
  for (const album of albums) {
    const label = normalizeGenre(album.genre);
    if (!label) continue;
    const key = genreKey(label);
    const existing = counts.get(key);
    counts.set(key, {
      label: existing?.label ?? label,
      count: (existing?.count ?? 0) + 1,
    });
  }
  const all = Array.from(counts.values())
    .map(({ label }) => label)
    .sort((a, b) => a.localeCompare(b));
  const featured = Array.from(counts.values())
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, featuredLimit)
    .map(({ label }) => label);
  return { all, featured };
}
