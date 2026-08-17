import {
  type AlbumId,
  type CollectionRouteSearch,
  parseAlbumIdParam,
  validateCollectionSearch,
} from "@/routing/routeContracts";
import type { OwnDataValue } from "@/ownData";

export type LibraryArtistRouteSearch = CollectionRouteSearch &
  Readonly<{ albumId?: AlbumId }>;

export function libraryArtistRouteSearch(
  value: OwnDataValue,
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
