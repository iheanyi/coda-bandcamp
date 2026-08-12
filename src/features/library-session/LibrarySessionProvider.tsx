import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { libraryStateQueryOptions } from "@/libraryQueries";
import { createLibrarySessionController } from "./librarySessionController";
import {
  contextSafeAlbum,
  LibrarySessionContext,
  type LibrarySessionProviderProps,
  type LibrarySessionValue,
} from "./librarySessionContext";

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
