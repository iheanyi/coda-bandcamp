import type { Album, Track } from "@/types";
import { cn } from "@/lib/utils";
import { AlbumDetailPage } from "./AlbumDetailPage";
import type { ArtistNavigationHandler } from "./types";

export type AlbumScreenModel = Readonly<{
  detail: Readonly<{
    album: Album;
    loading: boolean;
    favoriteAlbum: boolean;
    favoriteTrackIds: ReadonlySet<string>;
    currentTrackId?: string;
    currentAlbumId?: string;
    playing: boolean;
  }>;
}>;

export type AlbumScreenActions = Readonly<{
  detail: Readonly<{
    onBack: () => void;
    onPlayAlbum: () => void;
    onQueueAlbum: () => void;
    onPlayTrack: (track: Track) => void;
    onQueueTrack: (track: Track) => void;
    onArtist: ArtistNavigationHandler;
    onToggleFavoriteAlbum: () => void;
    onToggleFavoriteTrack: (track: Track) => void;
    onAddToPlaylist: (tracks: Track[]) => void;
    onTogglePlayback: () => void;
  }>;
}>;

export type AlbumScreenProps = {
  model: AlbumScreenModel;
  actions: AlbumScreenActions;
  className?: string;
};

export function AlbumScreen({ model, actions, className }: AlbumScreenProps) {
  return (
    <section className={cn("pt-6", className)} aria-live="polite">
      <AlbumDetailPage
        album={model.detail.album}
        loading={model.detail.loading}
        onBack={actions.detail.onBack}
        onPlayAlbum={actions.detail.onPlayAlbum}
        onQueueAlbum={actions.detail.onQueueAlbum}
        onPlayTrack={actions.detail.onPlayTrack}
        onQueueTrack={actions.detail.onQueueTrack}
        onArtist={actions.detail.onArtist}
        favoriteAlbum={model.detail.favoriteAlbum}
        favoriteTrackIds={model.detail.favoriteTrackIds}
        onToggleFavoriteAlbum={actions.detail.onToggleFavoriteAlbum}
        onToggleFavoriteTrack={actions.detail.onToggleFavoriteTrack}
        onAddToPlaylist={actions.detail.onAddToPlaylist}
        currentTrackId={model.detail.currentTrackId}
        currentAlbumId={model.detail.currentAlbumId}
        playing={model.detail.playing}
        onTogglePlayback={actions.detail.onTogglePlayback}
      />
    </section>
  );
}
