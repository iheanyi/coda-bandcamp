import {
  createContext,
  useContext,
  type ReactNode,
} from "react";
import type { AlbumId, ArtistKey } from "@/routing/routeContracts";
import type { RouteResource } from "@/routing/routeResource";
import type { AlbumScreenProps } from "./AlbumScreen";
import type { ArtistScreenProps } from "./ArtistScreen";
import type { CollectionScreenProps } from "./CollectionScreen";
import type { RecentScreenProps } from "./RecentScreen";

export type ReadyLibraryScreenResource<Value> = Extract<
  RouteResource<Value>,
  Readonly<{ status: "ready" }>
>;

export type LibraryRouteRuntime = Readonly<{
  getCollectionScreenProps: () => CollectionScreenProps;
  getRecentScreenProps: () => RecentScreenProps;
  resolveAlbumScreen: (
    albumId: AlbumId,
  ) => RouteResource<AlbumScreenProps>;
  resolveArtistScreen: (
    artistKey: ArtistKey,
    sourceAlbumId?: AlbumId,
  ) => RouteResource<ArtistScreenProps>;
}>;

export type LibraryRouteRuntimeProviderProps = Readonly<{
  children: ReactNode;
  runtime: LibraryRouteRuntime;
}>;

const LibraryRouteRuntimeContext = createContext<
  LibraryRouteRuntime | undefined
>(undefined);

export function LibraryRouteRuntimeProvider({
  children,
  runtime,
}: LibraryRouteRuntimeProviderProps) {
  return (
    <LibraryRouteRuntimeContext.Provider value={runtime}>
      {children}
    </LibraryRouteRuntimeContext.Provider>
  );
}

function useLibraryRouteRuntime(): LibraryRouteRuntime {
  const runtime = useContext(LibraryRouteRuntimeContext);
  if (!runtime) {
    throw new Error(
      "Library route screens must be rendered inside LibraryRouteRuntimeProvider",
    );
  }
  return runtime;
}

export function useCollectionRouteScreenProps(): CollectionScreenProps {
  return useLibraryRouteRuntime().getCollectionScreenProps();
}

export function useRecentRouteScreenProps(): RecentScreenProps {
  return useLibraryRouteRuntime().getRecentScreenProps();
}

export function useAlbumRouteScreenResource(
  albumId: AlbumId,
): RouteResource<AlbumScreenProps> {
  return useLibraryRouteRuntime().resolveAlbumScreen(albumId);
}

export function useArtistRouteScreenResource(
  artistKey: ArtistKey,
  sourceAlbumId?: AlbumId,
): RouteResource<ArtistScreenProps> {
  return useLibraryRouteRuntime().resolveArtistScreen(
    artistKey,
    sourceAlbumId,
  );
}
