import { useMemo } from "react";
import { genreKey } from "@/genres";
import {
  artistKey,
  groupAlbumsByArtist,
  matchesBrowseMode,
  resolveActiveArtist,
  summarizeLibraryCatalog,
  type ArtistGroup,
  type LibraryArtistFallback,
  type LibraryBrowseCounts,
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

export type LibraryBrowseController = Readonly<{
  activeArtist?: ArtistGroup;
  artistGroups: ArtistGroup[];
  counts: LibraryBrowseCounts;
  effectiveBrowseMode: LibraryBrowseMode;
  orderedGenreTabs: string[];
  visibleAlbums: Album[];
}>;

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
  const selectedGenreKey = genre === "All" ? undefined : genreKey(genre);
  const filtered = albums.filter((album) => {
    if (
      selectedGenreKey !== undefined &&
      genreKey(album.genre) !== selectedGenreKey
    ) {
      return false;
    }
    if (
      deferredQuery &&
      !ignoreDeferredArtistQuery &&
      !`${album.title} ${album.artist} ${album.genre ?? ""}`
        .toLowerCase()
        .includes(deferredQuery)
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
  return filtered.sort((left, right) =>
    sort === "artist"
      ? LIBRARY_COLLATOR.compare(left.artist, right.artist)
      : LIBRARY_COLLATOR.compare(left.title, right.title),
  );
}

function deriveLibraryBrowseView({
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
}: LibraryBrowseControllerInput): Omit<
  LibraryBrowseController,
  "counts" | "orderedGenreTabs"
> {
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
  const fallbackAlbumId =
    selectedArtistFallback && selectedArtistFallback.key === selectedArtist
      ? selectedArtistFallback.albumId
      : undefined;
  const artistScopeAlbums = selectedArtist
    ? matches.filter(
        (album) =>
          artistKey(album.artist) === selectedArtist ||
          album.id === fallbackAlbumId,
      )
    : matches;
  const artistGroups =
    effectiveBrowseMode === "artists" && !selectedArtist
      ? groupAlbumsByArtist(matches)
      : selectedArtist
        ? groupAlbumsByArtist(artistScopeAlbums)
        : [];
  const visibleAlbums =
    effectiveBrowseMode === "artists" && selectedArtist
      ? artistScopeAlbums
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
    effectiveBrowseMode,
    visibleAlbums,
  };
}

export function deriveLibraryBrowseController(
  input: LibraryBrowseControllerInput,
): LibraryBrowseController {
  return {
    ...deriveLibraryBrowseView(input),
    ...summarizeLibraryCatalog(input.albums),
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
  // Counts and genre tabs depend only on the catalog, not the active search or sort.
  const catalog = useMemo(() => summarizeLibraryCatalog(albums), [albums]);
  const browseView = useMemo(
    () =>
      deriveLibraryBrowseView({
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
  return useMemo(() => ({ ...browseView, ...catalog }), [browseView, catalog]);
}
