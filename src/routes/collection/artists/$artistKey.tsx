import { createFileRoute, notFound } from "@tanstack/react-router";
import { ArtistRouteScreen } from "@/features/library/ArtistRouteScreen";
import {
  ArtistRouteNotFound,
  ArtistRoutePending,
} from "@/features/library/LibraryDetailRouteStatus";
import { useArtistRouteScreenResource } from "@/features/library/LibraryRouteRuntime";
import {
  type AlbumId,
  type ArtistKey,
  type CollectionRouteSearch,
  parseAlbumIdParam,
  parseArtistKeyParam,
  stringifyArtistKeyParam,
  validateCollectionSearch,
} from "@/routing/routeContracts";
import { codaRouteMeta } from "@/routing/routeMeta";

export type ArtistRouteSearch = CollectionRouteSearch &
  Readonly<{ albumId?: AlbumId }>;

export function validateArtistRouteSearch(value: unknown): ArtistRouteSearch {
  const collectionSearch = validateCollectionSearch(value);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return collectionSearch;
  }

  try {
    const albumId = parseAlbumIdParam(Reflect.get(value, "albumId"));
    return { ...collectionSearch, albumId };
  } catch {
    return collectionSearch;
  }
}

type ArtistRouteIdentityLoaderInput = Readonly<{
  params: Readonly<{ artistKey: ArtistKey }>;
}>;

export function loadArtistRouteIdentity({
  params,
}: ArtistRouteIdentityLoaderInput): Readonly<{ artistKey: ArtistKey }> {
  return { artistKey: params.artistKey };
}

function ArtistDetailRoute() {
  const { artistKey } = Route.useLoaderData();
  const { albumId: sourceAlbumId } = Route.useSearch();
  const resource = useArtistRouteScreenResource(artistKey, sourceAlbumId);

  if (resource.status === "pending") return <ArtistRoutePending />;
  if (resource.status === "not-found") throw notFound();
  return <ArtistRouteScreen resource={resource} />;
}

export const Route = createFileRoute("/collection/artists/$artistKey")({
  component: ArtistDetailRoute,
  loader: loadArtistRouteIdentity,
  notFoundComponent: ArtistRouteNotFound,
  params: {
    parse: ({ artistKey }) => ({
      artistKey: parseArtistKeyParam(artistKey),
    }),
    stringify: ({ artistKey }) => ({
      artistKey: stringifyArtistKeyParam(artistKey),
    }),
  },
  pendingComponent: ArtistRoutePending,
  staticData: codaRouteMeta("artist", "library"),
  validateSearch: validateArtistRouteSearch,
});
