import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import type { ToastNotifier } from "@/components/ui/toastManager";
import { formatErrorMessage } from "@/formatError";
import { radioShowQueryOptions } from "@/queries/radioQueries";
import { radioShowIdFromTrackId } from "@/radioPlayback";
import type { Track } from "@/types";

import type { FavoritesController } from "./useLocalFavoritesController";

type CurrentFavoriteActions = Pick<
  FavoritesController,
  "ensureReady" | "toggleFavorite" | "toggleRadioFavorite"
>;

export type CurrentFavoriteControllerOptions = Readonly<{
  currentTrack?: Track;
  favorites: CurrentFavoriteActions;
  notify: ToastNotifier;
}>;

export type CurrentFavoriteController = Readonly<{
  toggle: () => void;
}>;

/** Resolves the current queue item's Bandcamp or device-local Radio favorite identity. */
export function useCurrentFavoriteController({
  currentTrack,
  favorites,
  notify,
}: CurrentFavoriteControllerOptions): CurrentFavoriteController {
  const queryClient = useQueryClient();

  const toggle = useCallback(() => {
    if (!currentTrack) return;
    if (currentTrack.id.startsWith("daily:")) {
      notify(
        "Bandcamp Daily previews cannot be added to Subsonic Favorites.",
        "bad",
      );
      return;
    }
    if (!favorites.ensureReady()) return;
    const radioShowId = radioShowIdFromTrackId(currentTrack.id);
    if (radioShowId === undefined) {
      favorites.toggleFavorite(currentTrack.id, "song");
      return;
    }
    void queryClient.fetchQuery(radioShowQueryOptions(radioShowId)).then(
      (show) => favorites.toggleRadioFavorite(show),
      (cause) => notify(formatErrorMessage(cause), "bad"),
    );
  }, [currentTrack, favorites, notify, queryClient]);

  return { toggle };
}
