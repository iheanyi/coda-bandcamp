import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import type { ToastNotifier } from "@/components/ui/toastManager";
import { radioShowQueryOptions } from "@/queries/radioQueries";
import { radioShowIdFromTrackId } from "@/radioPlayback";
import type { Track } from "@/types";

import type { LocalFavoritesController } from "./useLocalFavoritesController";

type CurrentFavoriteActions = Pick<
  LocalFavoritesController,
  "ensureReady" | "toggleFavorite" | "toggleRadioFavorite"
>;

export type CurrentFavoriteControllerOptions = Readonly<{
  currentTrack?: Track;
  favorites: CurrentFavoriteActions;
  notify: ToastNotifier;
}>;

/** Resolves the current queue item's device-local favorite identity. */
export function useCurrentFavoriteController({
  currentTrack,
  favorites,
  notify,
}: CurrentFavoriteControllerOptions): Readonly<{ toggle: () => void }> {
  const queryClient = useQueryClient();

  const toggle = useCallback(() => {
    if (!currentTrack || !favorites.ensureReady()) return;
    const radioShowId = radioShowIdFromTrackId(currentTrack.id);
    if (radioShowId === undefined) {
      favorites.toggleFavorite(currentTrack.id, "song");
      return;
    }
    void queryClient.fetchQuery(radioShowQueryOptions(radioShowId)).then(
      (show) => favorites.toggleRadioFavorite(show),
      (cause) => notify(String(cause).replace(/^Error:\s*/u, ""), "bad"),
    );
  }, [currentTrack, favorites, notify, queryClient]);

  return { toggle };
}
