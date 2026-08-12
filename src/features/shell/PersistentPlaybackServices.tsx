import { useMemo } from "react";

import { MiniPlayerBridge } from "@/MiniPlayerBridge";
import type { PlaybackRuntimeController } from "@/features/playback-runtime";
import type { CodaPrimaryView } from "@/routing/routeMeta";
import type { Album } from "@/types";

import { WindowTitleController } from "./WindowTitleController";

export type PersistentPlaybackServicesProps = Readonly<{
  activeArtistName?: string;
  albums: readonly Album[];
  nowPlayingOpen: boolean;
  playback: PlaybackRuntimeController;
  selectedAlbumTitle?: string;
  showMainWindow: () => void;
  view: CodaPrimaryView;
}>;

/**
 * Keeps native mini-player synchronization and window-title projection beside
 * the persistent playback runtime instead of route content.
 */
export function PersistentPlaybackServices({
  activeArtistName,
  albums,
  nowPlayingOpen,
  playback,
  selectedAlbumTitle,
  showMainWindow,
  view,
}: PersistentPlaybackServicesProps) {
  const { currentRadioTimeline, currentTrack } = playback.queue;
  const { canNext, canPrevious, playing, volume } = playback.transport;
  const { next, previous, seek, setVolume, toggle } =
    playback.transportCommands;
  const currentAlbum = useMemo(
    () =>
      currentTrack
        ? albums.find((album) => album.id === currentTrack.albumId)
        : undefined,
    [albums, currentTrack],
  );

  return (
    <>
      <MiniPlayerBridge
        track={currentTrack}
        artwork={currentAlbum}
        radioTimeline={currentRadioTimeline}
        playbackClock={playback.playbackClock}
        playing={playing}
        durationSeconds={currentTrack?.duration ?? 0}
        volume={volume}
        canPrevious={canPrevious}
        canNext={canNext}
        onTogglePlayback={toggle}
        onPrevious={previous}
        onNext={next}
        onSeek={seek}
        onSetVolume={setVolume}
        onShowMain={showMainWindow}
      />
      <WindowTitleController
        playbackClock={playback.playbackClock}
        currentTrack={currentTrack}
        radioTimeline={currentRadioTimeline}
        nowPlayingOpen={nowPlayingOpen}
        selectedAlbumTitle={selectedAlbumTitle}
        activeArtistName={activeArtistName}
        view={view}
      />
    </>
  );
}
