import type { Album, Track } from "./types";

export type LibraryBrowseMode = "releases" | "artists" | "albums" | "singles";

export type ArtistGroup = {
  key: string;
  name: string;
  albums: Album[];
  releaseCount: number;
  trackCount: number;
  duration: number;
  representative: Album;
  trackFilterArtistKey?: string;
  trackFilterAlbumId?: string;
};

export function artistKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export function matchesBrowseMode(album: Album, mode: LibraryBrowseMode): boolean {
  if (mode === "singles") return album.songCount === 1;
  if (mode === "albums") return album.songCount > 1;
  return true;
}

export function groupAlbumsByArtist(albums: readonly Album[]): ArtistGroup[] {
  const groups = new Map<string, Album[]>();
  for (const album of albums) {
    const key = artistKey(album.artist) || "unknown artist";
    const existing = groups.get(key);
    if (existing) {
      existing.push(album);
    } else {
      groups.set(key, [album]);
    }
  }

  return Array.from(groups, ([key, releases]) => {
    const sorted = [...releases].sort(
      (a, b) =>
        (b.addedAt ?? "").localeCompare(a.addedAt ?? "") ||
        (b.year ?? 0) - (a.year ?? 0) ||
        a.title.localeCompare(b.title),
    );
    return {
      key,
      name: releases[0]?.artist.trim().replace(/\s+/g, " ") || "Unknown artist",
      albums: sorted,
      releaseCount: sorted.length,
      trackCount: sorted.reduce((total, album) => total + album.songCount, 0),
      duration: sorted.reduce((total, album) => total + album.duration, 0),
      representative: sorted[0],
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export function tracksForArtistGroupAlbum(
  group: Pick<ArtistGroup, "trackFilterAlbumId" | "trackFilterArtistKey">,
  albumId: string,
  tracks: Track[],
): Track[] {
  if (
    !group.trackFilterArtistKey ||
    (group.trackFilterAlbumId && group.trackFilterAlbumId !== albumId)
  ) {
    return tracks;
  }
  return tracks.filter(
    (track) => artistKey(track.artist) === group.trackFilterArtistKey,
  );
}
