import {
  type AlbumId,
  type CollectionRouteSearch,
  parseAlbumIdParam,
  validateCollectionSearch,
} from "@/routing/routeContracts";

export type LibraryArtistRouteSearch = CollectionRouteSearch &
  Readonly<{ albumId?: AlbumId }>;

export function libraryArtistRouteSearch(
  value: unknown,
  sourceAlbumId?: string,
): LibraryArtistRouteSearch {
  const search = validateCollectionSearch(value);
  return {
    ...search,
    genre: "All",
    mode: "artists",
    q: "",
    ...(sourceAlbumId
      ? { albumId: parseAlbumIdParam(sourceAlbumId) }
      : undefined),
  };
}
