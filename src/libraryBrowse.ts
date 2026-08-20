import {
  orderedGenreTabsFromCounts,
  recordAlbumGenre,
  type GenreCountEntry,
} from "./genres";
import {
  compareAlbumsByNewestRelease,
  sortAlbumsByNewestAdded,
} from "./libraryDates";
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

export type LibraryBrowseCounts = Readonly<{
  albums: number;
  artists: number;
  singles: number;
}>;

export type LibraryCatalogSummary = Readonly<{
  counts: LibraryBrowseCounts;
  orderedGenreTabs: string[];
}>;

export function summarizeLibraryCatalog(
  albums: readonly Album[],
): LibraryCatalogSummary {
  const artists = new Set<string>();
  let albumCount = 0;
  let singleCount = 0;
  const genreCounts = new Map<string, GenreCountEntry>();
  for (const album of albums) {
    artists.add(artistKey(album.artist));
    if (matchesBrowseMode(album, "albums")) albumCount += 1;
    if (matchesBrowseMode(album, "singles")) singleCount += 1;
    recordAlbumGenre(genreCounts, album.genre);
  }
  return {
    counts: {
      albums: albumCount,
      artists: artists.size,
      singles: singleCount,
    },
    orderedGenreTabs: orderedGenreTabsFromCounts(genreCounts),
  };
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
    const sorted = sortAlbumsByNewestAdded(
      releases,
      compareAlbumsByNewestRelease,
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

export function tracksForScopeAlbum(
  artistScope:
    | Pick<ArtistGroup, "trackFilterAlbumId" | "trackFilterArtistKey">
    | undefined,
  albumId: string,
  tracks: Track[] = [],
): Track[] {
  return artistScope
    ? tracksForArtistGroupAlbum(artistScope, albumId, tracks)
    : tracks;
}

export type LibraryArtistFallback = Readonly<{
  albumId: string;
  key: string;
  name: string;
  knownTrack?: Readonly<{
    duration: number;
    id: string;
  }>;
}>;

export function resolveActiveArtist({
  albums,
  artistGroups,
  fallbackAlbumCandidateTracks,
  selectedArtist,
  selectedArtistFallback,
}: Readonly<{
  albums: readonly Album[];
  artistGroups: ArtistGroup[];
  fallbackAlbumCandidateTracks: readonly Track[];
  selectedArtist?: string;
  selectedArtistFallback?: LibraryArtistFallback;
}>): ArtistGroup | undefined {
  const exactGroup = artistGroups.find((group) => group.key === selectedArtist);
  if (!selectedArtist || selectedArtistFallback?.key !== selectedArtist) {
    return exactGroup;
  }

  const fallbackAlbum = albums.find(
    (album) => album.id === selectedArtistFallback.albumId,
  );
  if (!fallbackAlbum) return exactGroup;
  if (exactGroup?.albums.some((album) => album.id === fallbackAlbum.id)) {
    return exactGroup;
  }

  const fallbackTracks = fallbackAlbumCandidateTracks.filter(
    (track) => artistKey(track.artist) === selectedArtistFallback.key,
  );
  const fallbackTrackCount =
    fallbackTracks.length || (selectedArtistFallback.knownTrack ? 1 : 0);
  const fallbackDuration = fallbackTracks.length
    ? fallbackTracks.reduce((total, track) => total + track.duration, 0)
    : (selectedArtistFallback.knownTrack?.duration ?? 0);

  return {
    key: selectedArtist,
    name: selectedArtistFallback.name,
    albums: [...(exactGroup?.albums ?? []), fallbackAlbum],
    releaseCount: (exactGroup?.releaseCount ?? 0) + 1,
    trackCount: (exactGroup?.trackCount ?? 0) + fallbackTrackCount,
    duration: (exactGroup?.duration ?? 0) + fallbackDuration,
    representative: exactGroup?.representative ?? fallbackAlbum,
    trackFilterArtistKey: selectedArtistFallback.key,
    trackFilterAlbumId: fallbackAlbum.id,
  };
}

export function resolveAlbumSummary(
  albumId: string,
  ...sources: ReadonlyArray<Album | undefined | readonly Album[]>
): Album | undefined {
  for (const source of sources) {
    if (!source) continue;
    if ("id" in source) {
      if (source.id === albumId) return source;
      continue;
    }
    const found = source.find((album) => album.id === albumId);
    if (found) return found;
  }
  return undefined;
}
