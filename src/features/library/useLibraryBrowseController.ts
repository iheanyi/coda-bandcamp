import { useMemo } from "react";
import { genreKey, summarizeGenres } from "@/genres";
import {
  artistKey,
  groupAlbumsByArtist,
  matchesBrowseMode,
  type ArtistGroup,
  type LibraryBrowseMode,
} from "@/libraryBrowse";
import {
  sortAlbumsByNewestAdded,
  sortAlbumsByNewestRelease,
} from "@/libraryDates";
import type { CodaPrimaryView } from "@/routing/routeMeta";
import type { Album, SortMode, Track } from "@/types";

const LIBRARY_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export type LibraryArtistFallback = Readonly<{
  albumId: string;
  key: string;
  name: string;
  knownTrack?: Readonly<{
    duration: number;
    id: string;
  }>;
}>;

export type LibraryBrowseControllerInput = Readonly<{
  albums: readonly Album[];
  browseMode: LibraryBrowseMode;
  deferredQuery: string;
  fallbackAlbumCandidateTracks: readonly Track[];
  genre: string;
  ignoreDeferredArtistQuery: boolean;
  selectedArtist?: string;
  selectedArtistFallback?: LibraryArtistFallback;
  sort: SortMode;
  view: CodaPrimaryView;
}>;

export type LibraryBrowseCounts = Readonly<{
  albums: number;
  artists: number;
  singles: number;
}>;

export type LibraryBrowseController = Readonly<{
  activeArtist?: ArtistGroup;
  artistGroups: ArtistGroup[];
  counts: LibraryBrowseCounts;
  effectiveBrowseMode: LibraryBrowseMode;
  orderedGenreTabs: string[];
  visibleAlbums: Album[];
}>;

function orderedGenres(albums: readonly Album[]): string[] {
  const summary = summarizeGenres(albums);
  const featuredKeys = new Set(summary.featured.map(genreKey));
  return [
    ...summary.featured,
    ...summary.all.filter((genre) => !featuredKeys.has(genreKey(genre))),
  ];
}

function browseCounts(albums: readonly Album[]): LibraryBrowseCounts {
  const artists = new Set<string>();
  let albumCount = 0;
  let singleCount = 0;
  for (const album of albums) {
    artists.add(artistKey(album.artist));
    if (matchesBrowseMode(album, "albums")) albumCount += 1;
    if (matchesBrowseMode(album, "singles")) singleCount += 1;
  }
  return {
    albums: albumCount,
    artists: artists.size,
    singles: singleCount,
  };
}

function matchingAlbums({
  albums,
  deferredQuery,
  effectiveBrowseMode,
  genre,
  ignoreDeferredArtistQuery,
  sort,
  view,
}: Readonly<{
  albums: readonly Album[];
  deferredQuery: string;
  effectiveBrowseMode: LibraryBrowseMode;
  genre: string;
  ignoreDeferredArtistQuery: boolean;
  sort: SortMode;
  view: CodaPrimaryView;
}>): Album[] {
  const searchIndex = new Map(
    albums.map((album) => [
      album.id,
      `${album.title} ${album.artist} ${album.genre ?? ""}`.toLowerCase(),
    ]),
  );
  const filtered = albums.filter((album) => {
    if (genre !== "All" && genreKey(album.genre) !== genreKey(genre)) {
      return false;
    }
    if (
      deferredQuery &&
      !ignoreDeferredArtistQuery &&
      !searchIndex.get(album.id)?.includes(deferredQuery)
    ) {
      return false;
    }
    return matchesBrowseMode(album, effectiveBrowseMode);
  });

  if (view === "recent") {
    return sortAlbumsByNewestAdded(filtered).slice(0, 12);
  }
  if (sort === "year") return sortAlbumsByNewestRelease(filtered);
  if (sort === "recent") return sortAlbumsByNewestAdded(filtered);
  return [...filtered].sort((left, right) =>
    sort === "artist"
      ? LIBRARY_COLLATOR.compare(left.artist, right.artist)
      : LIBRARY_COLLATOR.compare(left.title, right.title),
  );
}

function resolveActiveArtist({
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

export function deriveLibraryBrowseController({
  albums,
  browseMode,
  deferredQuery,
  fallbackAlbumCandidateTracks,
  genre,
  ignoreDeferredArtistQuery,
  selectedArtist,
  selectedArtistFallback,
  sort,
  view,
}: LibraryBrowseControllerInput): LibraryBrowseController {
  const effectiveBrowseMode = view === "library" ? browseMode : "releases";
  const matches = matchingAlbums({
    albums,
    deferredQuery,
    effectiveBrowseMode,
    genre,
    ignoreDeferredArtistQuery,
    sort,
    view,
  });
  const artistGroups = groupAlbumsByArtist(matches);
  const fallbackAlbumId =
    selectedArtistFallback && selectedArtistFallback.key === selectedArtist
      ? selectedArtistFallback.albumId
      : undefined;
  const visibleAlbums =
    effectiveBrowseMode === "artists" && selectedArtist
      ? matches.filter(
          (album) =>
            artistKey(album.artist) === selectedArtist ||
            album.id === fallbackAlbumId,
        )
      : matches;

  return {
    activeArtist: resolveActiveArtist({
      albums,
      artistGroups,
      fallbackAlbumCandidateTracks,
      selectedArtist,
      selectedArtistFallback,
    }),
    artistGroups,
    counts: browseCounts(albums),
    effectiveBrowseMode,
    orderedGenreTabs: orderedGenres(albums),
    visibleAlbums,
  };
}

export function useLibraryBrowseController(
  input: LibraryBrowseControllerInput,
): LibraryBrowseController {
  const {
    albums,
    browseMode,
    deferredQuery,
    fallbackAlbumCandidateTracks,
    genre,
    ignoreDeferredArtistQuery,
    selectedArtist,
    selectedArtistFallback,
    sort,
    view,
  } = input;
  return useMemo(
    () =>
      deriveLibraryBrowseController({
        albums,
        browseMode,
        deferredQuery,
        fallbackAlbumCandidateTracks,
        genre,
        ignoreDeferredArtistQuery,
        selectedArtist,
        selectedArtistFallback,
        sort,
        view,
      }),
    [
      albums,
      browseMode,
      deferredQuery,
      fallbackAlbumCandidateTracks,
      genre,
      ignoreDeferredArtistQuery,
      selectedArtist,
      selectedArtistFallback,
      sort,
      view,
    ],
  );
}
