import {
  type AlbumId,
  type ArtistKey,
  type CollectionRouteSearch,
  parseAlbumIdParam,
  parseArtistKeyParam,
  validateCollectionSearch,
} from "./routeContracts";
import type { CodaScreen } from "./routeMeta";

type LibraryScreen = "collection" | "recent" | "album" | "artist";

type NonLibraryScreen = Exclude<CodaScreen, LibraryScreen>;

export type LibraryRouteInputSource = Readonly<{
  screen: CodaScreen | undefined;
  search: unknown;
  albumId?: unknown;
  artistKey?: unknown;
  sourceAlbumId?: unknown;
}>;

type NonLibraryRouteInput = Readonly<{
  kind: "inactive";
  reason: "non-library-screen";
  screen: NonLibraryScreen | undefined;
}>;

type MissingAlbumRouteInput = Readonly<{
  kind: "inactive";
  reason: "missing-album-id" | "invalid-album-id";
  screen: "album";
  collectionSearch: CollectionRouteSearch;
}>;

type MissingArtistRouteInput = Readonly<{
  kind: "inactive";
  reason: "missing-artist-key" | "invalid-artist-key";
  screen: "artist";
  collectionSearch: CollectionRouteSearch;
}>;

export type InactiveLibraryRouteInput =
  NonLibraryRouteInput | MissingAlbumRouteInput | MissingArtistRouteInput;

export type CollectionLibraryRouteInput = Readonly<{
  kind: "collection";
  screen: "collection";
  collectionSearch: CollectionRouteSearch;
}>;

export type RecentLibraryRouteInput = Readonly<{
  kind: "recent";
  screen: "recent";
  collectionSearch: CollectionRouteSearch;
}>;

export type AlbumLibraryRouteInput = Readonly<{
  kind: "album";
  screen: "album";
  collectionSearch: CollectionRouteSearch;
  albumId: AlbumId;
}>;

export type ArtistLibraryRouteInput = Readonly<{
  kind: "artist";
  screen: "artist";
  collectionSearch: CollectionRouteSearch;
  artistKey: ArtistKey;
  sourceAlbumId?: AlbumId;
}>;

export type LibraryRouteInput =
  | InactiveLibraryRouteInput
  | CollectionLibraryRouteInput
  | RecentLibraryRouteInput
  | AlbumLibraryRouteInput
  | ArtistLibraryRouteInput;

export type LibraryRouteChromeVisibility = Readonly<{
  browse: boolean;
  filter: boolean;
}>;

/** Keeps route-specific collection chrome out of album and artist details. */
export function libraryRouteChromeVisibility(
  input: LibraryRouteInput,
): LibraryRouteChromeVisibility {
  return {
    browse: input.kind === "collection",
    filter: input.kind === "collection" || input.kind === "recent",
  };
}

type ParsedIdentity<Value> =
  | Readonly<{ status: "missing" }>
  | Readonly<{ status: "invalid" }>
  | Readonly<{ status: "ready"; value: Value }>;

function parseRequiredIdentity<Value>(
  value: unknown,
  parse: (candidate: unknown) => Value,
): ParsedIdentity<Value> {
  if (value === undefined || value === null) return { status: "missing" };

  try {
    return { status: "ready", value: parse(value) };
  } catch {
    return { status: "invalid" };
  }
}

function parseOptionalAlbumId(value: unknown): AlbumId | undefined {
  if (value === undefined || value === null) return undefined;

  try {
    return parseAlbumIdParam(value);
  } catch {
    return undefined;
  }
}

export function deriveLibraryRouteInput({
  albumId,
  artistKey,
  screen,
  search,
  sourceAlbumId,
}: LibraryRouteInputSource): LibraryRouteInput {
  switch (screen) {
    case "collection":
      return {
        kind: "collection",
        screen,
        collectionSearch: validateCollectionSearch(search),
      };
    case "recent":
      return {
        kind: "recent",
        screen,
        collectionSearch: validateCollectionSearch(search),
      };
    case "album": {
      const collectionSearch = validateCollectionSearch(search);
      const identity = parseRequiredIdentity(albumId, parseAlbumIdParam);
      if (identity.status !== "ready") {
        return {
          kind: "inactive",
          reason:
            identity.status === "missing"
              ? "missing-album-id"
              : "invalid-album-id",
          screen,
          collectionSearch,
        };
      }
      return {
        kind: "album",
        screen,
        collectionSearch,
        albumId: identity.value,
      };
    }
    case "artist": {
      const collectionSearch = validateCollectionSearch(search);
      const identity = parseRequiredIdentity(artistKey, parseArtistKeyParam);
      if (identity.status !== "ready") {
        return {
          kind: "inactive",
          reason:
            identity.status === "missing"
              ? "missing-artist-key"
              : "invalid-artist-key",
          screen,
          collectionSearch,
        };
      }
      const parsedSourceAlbumId = parseOptionalAlbumId(sourceAlbumId);
      return {
        kind: "artist",
        screen,
        collectionSearch,
        artistKey: identity.value,
        ...(parsedSourceAlbumId === undefined
          ? {}
          : { sourceAlbumId: parsedSourceAlbumId }),
      };
    }
    default:
      return {
        kind: "inactive",
        reason: "non-library-screen",
        screen,
      };
  }
}
