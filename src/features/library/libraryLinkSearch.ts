import {
  type AlbumId,
  type CollectionRouteSearch,
  parseAlbumIdParam,
  validateCollectionSearch,
} from "@/routing/routeContracts";

export type LibraryArtistRouteSearch = CollectionRouteSearch &
  Readonly<{ albumId?: AlbumId }>;

export function libraryArtistRouteSearch<Search>(
  value: Search,
  sourceAlbumId?: string,
): LibraryArtistRouteSearch {
  const search: LibraryArtistRouteSearch = {
    ...validateCollectionSearch(value),
    genre: "All",
    mode: "artists",
    q: "",
  };
  return sourceAlbumId
    ? { ...search, albumId: parseAlbumIdParam(sourceAlbumId) }
    : search;
}
