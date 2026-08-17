import { FavoritesView } from "./FavoritesView";
import { PlaylistsController } from "./PlaylistsController";
import type { SavedLibraryControllerProps } from "./savedLibraryTypes";

export function SavedLibraryController(props: SavedLibraryControllerProps) {
  if (props.mode === "playlists") {
    return <PlaylistsController {...props} />;
  }

  return <FavoritesView {...props} />;
}
