import type { RefObject } from "react";

import type { RadioChapterLocalLinks } from "@/RadioChapterMetadata";
import type { ArtistNavigationHandler } from "@/features/library/types";
import type { PlaybackRuntimeController } from "@/features/playback-runtime";
import { radioShowIdFromTrackId } from "@/radioPlayback";
import type { RadioChapter, Track } from "@/types";

import { PlayerDock } from "./PlayerDock";

export type PlayerDockFavorites = Readonly<{
  onAddToPlaylist: (tracks: readonly Track[]) => void;
  onToggleCurrent: () => void;
  radioShowIds: ReadonlySet<number>;
  trackIds: ReadonlySet<string>;
}>;

export type PlayerDockNavigation = Readonly<{
  onAlbum: (track: Track, trigger?: HTMLElement) => void;
  onArtist: ArtistNavigationHandler;
  onNowPlaying: () => void;
  onOpenRadioItem: (url: string) => void;
}>;

export type PersistentPlayerDockProps = Readonly<{
  favorites: PlayerDockFavorites;
  getRadioChapterLocalLinks: (chapter: RadioChapter) => RadioChapterLocalLinks;
  loadingAlbumId?: string;
  navigation: PlayerDockNavigation;
  nowPlayingOpen: boolean;
  playback: PlaybackRuntimeController;
  queueControlRef: RefObject<HTMLButtonElement | null>;
  visible: boolean;
}>;

/**
 * Adapts persistent playback state into the dock without route-owned state.
 * Keep the compact artwork mounted while Now Playing is open so Back can
 * restore Open Now Playing without remounting CoverArt on the Radio or
 * Collection commit. Hide with visibility, not display:none, so the reverse
 * morph still has a real compact-bar rect at the bottom of the window.
 */
export function PersistentPlayerDock({
  favorites,
  getRadioChapterLocalLinks,
  loadingAlbumId,
  navigation,
  nowPlayingOpen,
  playback,
  queueControlRef,
  visible,
}: PersistentPlayerDockProps) {
  const {
    currentRadioTimeline,
    currentTrack,
    open: queueOpen,
  } = playback.queue;
  const currentRadioShowId = currentTrack
    ? radioShowIdFromTrackId(currentTrack.id)
    : undefined;
  const favorite = currentTrack
    ? currentRadioShowId !== undefined
      ? favorites.radioShowIds.has(currentRadioShowId)
      : favorites.trackIds.has(currentTrack.id)
    : false;
  const dailyPreview = currentTrack?.id.startsWith("daily:") ?? false;

  const dock = (
    <PlayerDock
      mode={visible && nowPlayingOpen ? "now-playing-queue" : "full"}
      track={currentTrack}
      radioTimeline={currentRadioTimeline}
      playing={playback.transport.playing}
      playbackClock={playback.playbackClock}
      duration={currentTrack?.duration ?? 0}
      volume={playback.transport.volume}
      repeat={playback.transport.repeat}
      onToggle={playback.transportCommands.toggle}
      onPrevious={playback.transportCommands.previous}
      onNext={playback.transportCommands.next}
      canPrevious={playback.transport.canPrevious}
      canNext={playback.transport.canNext}
      onSeek={playback.transportCommands.seek}
      onVolume={playback.transportCommands.setVolume}
      onRepeat={playback.transportCommands.cycleRepeat}
      airPlayAvailable={playback.transport.airPlayAvailable}
      onAirPlay={playback.transportCommands.openAirPlay}
      onArtist={navigation.onArtist}
      onAlbum={navigation.onAlbum}
      albumLoading={Boolean(
        currentTrack && loadingAlbumId === currentTrack.albumId,
      )}
      onNowPlaying={navigation.onNowPlaying}
      onOpenRadioItem={navigation.onOpenRadioItem}
      getRadioChapterLocalLinks={getRadioChapterLocalLinks}
      favorite={favorite}
      onToggleFavorite={dailyPreview ? undefined : favorites.onToggleCurrent}
      onAddToPlaylist={
        dailyPreview
          ? undefined
          : () => {
              if (currentTrack) favorites.onAddToPlaylist([currentTrack]);
            }
      }
      queueOpen={queueOpen}
      queueControlRef={queueControlRef}
    />
  );

  return (
    <div
      aria-hidden={visible ? undefined : true}
      className={
        visible
          ? "contents"
          : "pointer-events-none invisible fixed inset-x-0 bottom-0 z-3"
      }
      data-slot={visible ? undefined : "player-dock-hidden"}
      inert={visible ? undefined : true}
    >
      {dock}
    </div>
  );
}
