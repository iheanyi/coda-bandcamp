import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ToastNotifier } from "@/components/ui/toastManager";
import { libraryStateQueryOptions } from "@/libraryQueries";
import type { Album } from "@/types";
import {
  createLibrarySessionController,
  type LibrarySessionCommands,
  type LibrarySessionController,
  type LibrarySessionRouteReader,
  type LibrarySessionState,
} from "./librarySessionController";

export type LibrarySessionValue = Readonly<{
  albums: readonly Album[];
  commands: LibrarySessionCommands;
  route: LibrarySessionRouteReader;
  state: LibrarySessionState;
}>;

export type LibrarySessionProviderProps = Readonly<{
  children: ReactNode;
  controller?: LibrarySessionController;
  notify?: ToastNotifier;
}>;

const LibrarySessionContext = createContext<LibrarySessionValue | undefined>(
  undefined,
);

function contextSafeAlbum(album: Album): Album {
  const { artworkUrl: _signedArtworkUrl, tracks: _tracks, ...summary } = album;
  const safeAlbum: Album = {
    ...summary,
    palette: [album.palette[0], album.palette[1]],
  };
  return Object.freeze(safeAlbum);
}

export function LibrarySessionProvider({
  children,
  controller: providedController,
  notify,
}: LibrarySessionProviderProps) {
  const queryClient = useQueryClient();
  const [controller] = useState(
    () =>
      providedController ??
      createLibrarySessionController({ notify, queryClient }),
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const { data: queryAlbums } = useQuery(libraryStateQueryOptions);
  const albums = useMemo(
    () => Object.freeze(queryAlbums.map(contextSafeAlbum)),
    [queryAlbums],
  );

  useEffect(() => controller.activate(), [controller]);

  const value = useMemo<LibrarySessionValue>(
    () =>
      Object.freeze({
        albums,
        commands: controller.commands,
        route: controller.route,
        state,
      }),
    [albums, controller, state],
  );

  return (
    <LibrarySessionContext.Provider value={value}>
      {children}
    </LibrarySessionContext.Provider>
  );
}

export function useLibrarySession(): LibrarySessionValue {
  const value = useContext(LibrarySessionContext);
  if (!value) {
    throw new Error("Library session consumers require LibrarySessionProvider");
  }
  return value;
}
