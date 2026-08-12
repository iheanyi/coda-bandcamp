import { createFileRoute, notFound } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlbumRouteScreen } from "@/features/library/AlbumRouteScreen";
import {
  AlbumRouteNotFound,
  AlbumRoutePending,
} from "@/features/library/LibraryDetailRouteStatus";
import { useAlbumRouteScreenResource } from "@/features/library/LibraryRouteRuntime";
import {
  type AlbumId,
  parseAlbumIdParam,
  stringifyAlbumIdParam,
} from "@/routing/routeContracts";
import { codaRouteMeta } from "@/routing/routeMeta";
import {
  useLibrarySession,
  type LibrarySessionRouteReader,
} from "@/features/library-session";

type AlbumRouteIdentityLoaderInput = Readonly<{
  librarySession?: LibrarySessionRouteReader;
  params: Readonly<{ albumId: AlbumId }>;
}>;

export function loadAlbumRouteIdentity({
  librarySession,
  params,
}: AlbumRouteIdentityLoaderInput): Readonly<{ albumId: AlbumId }> {
  librarySession?.preloadAlbum(params.albumId);
  return { albumId: params.albumId };
}

function AlbumDetailRoute() {
  const { albumId } = Route.useLoaderData();
  const librarySession = useLibrarySession();
  const resource = useAlbumRouteScreenResource(albumId);
  const generation = librarySession.commands.generation.current();
  const album = librarySession.albums.find(
    (candidate) => candidate.id === albumId,
  );
  const resourceHasTracks =
    resource.status === "ready" &&
    resource.value.model.detail.album.tracks !== undefined;
  const shouldHydrate =
    librarySession.state.connection === "connected" &&
    album !== undefined &&
    !resourceHasTracks;
  const [settledAttempt, setSettledAttempt] = useState<
    Readonly<{ albumId: string; generation: number }> | undefined
  >();
  const attemptSettled =
    settledAttempt?.albumId === albumId &&
    settledAttempt.generation === generation;

  useEffect(() => {
    if (!shouldHydrate || !album || attemptSettled) return;
    let active = true;
    const settle = () => {
      if (active && librarySession.commands.generation.isCurrent(generation)) {
        setSettledAttempt({ albumId, generation });
      }
    };
    void librarySession.commands
      .ensureAlbum(album, "preload")
      .then(settle, settle);
    return () => {
      active = false;
    };
  }, [
    album,
    albumId,
    attemptSettled,
    generation,
    librarySession.commands,
    shouldHydrate,
  ]);

  if (resource.status === "pending") return <AlbumRoutePending />;
  if (resource.status === "not-found") throw notFound();
  const displayedResource =
    shouldHydrate && !attemptSettled && !resource.value.model.detail.loading
      ? {
          ...resource,
          value: {
            ...resource.value,
            model: {
              ...resource.value.model,
              detail: {
                ...resource.value.model.detail,
                loading: true,
              },
            },
          },
        }
      : resource;
  return <AlbumRouteScreen resource={displayedResource} />;
}

export const Route = createFileRoute("/collection/albums/$albumId")({
  component: AlbumDetailRoute,
  params: {
    parse: ({ albumId }) => ({
      albumId: parseAlbumIdParam(albumId),
    }),
    stringify: ({ albumId }) => ({
      albumId: stringifyAlbumIdParam(albumId),
    }),
  },
  loader: ({ context, params }) =>
    loadAlbumRouteIdentity({
      librarySession: context.librarySession,
      params,
    }),
  notFoundComponent: AlbumRouteNotFound,
  pendingComponent: AlbumRoutePending,
  staticData: codaRouteMeta("album", "library"),
});
