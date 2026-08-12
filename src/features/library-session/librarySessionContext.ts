import { createContext, useContext, type ReactNode } from "react";

import type { ToastNotifier } from "@/components/ui/toastManager";
import type { Album } from "@/types";

import type {
  LibrarySessionCommands,
  LibrarySessionController,
  LibrarySessionRouteReader,
  LibrarySessionState,
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

export const LibrarySessionContext = createContext<
  LibrarySessionValue | undefined
>(undefined);

export function contextSafeAlbum(album: Album): Album {
  const { artworkUrl: _signedArtworkUrl, tracks: _tracks, ...summary } = album;
  const safeAlbum: Album = {
    ...summary,
    palette: [album.palette[0], album.palette[1]],
  };
  return Object.freeze(safeAlbum);
}

export function useLibrarySession(): LibrarySessionValue {
  const value = useContext(LibrarySessionContext);
  if (!value) {
    throw new Error("Library session consumers require LibrarySessionProvider");
  }
  return value;
}
