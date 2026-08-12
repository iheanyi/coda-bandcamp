import type { RadioChapterLocalLinks } from "@/RadioChapterMetadata";
import type { ArtistNavigationHandler } from "@/features/library/types";
import type { PlaybackRuntimeController } from "@/features/playback-runtime";
import type { Album, RadioChapter, Track } from "@/types";

import { QueuePanel } from "./QueuePanel";
import type { QueueFocusController } from "./useQueueFocusController";
import type { QueueRecommendationController } from "./useQueueRecommendationController";

export type QueueSurfaceNavigation = Readonly<{
  onAlbum: (track: Track, trigger?: HTMLElement) => void;
  onArtist: ArtistNavigationHandler;
  onNowPlaying: () => void;
  onOpenRadioItem: (url: string) => void;
  onRadioSeries?: (seriesId?: number, trigger?: HTMLAnchorElement) => void;
  onRecommendationAlbum?: (
    album: Album,
    trigger: HTMLAnchorElement,
  ) => void;
}>;

export type PersistentQueueSurfaceProps = Readonly<{
  focus: QueueFocusController;
  getRadioChapterLocalLinks: (
    chapter: RadioChapter,
  ) => RadioChapterLocalLinks;
  loadingAlbumId?: string;
  navigation: QueueSurfaceNavigation;
  onClear: () => void;
  playback: PlaybackRuntimeController;
  playerVisible: boolean;
  recommendation: QueueRecommendationController;
  recommendationPlayLoading: boolean;
}>;

/** Adapts focused playback/navigation controllers into the queue UI. */
export function PersistentQueueSurface({
  focus,
  getRadioChapterLocalLinks,
  loadingAlbumId,
  navigation,
  onClear,
  playback,
  playerVisible,
  recommendation,
  recommendationPlayLoading,
}: PersistentQueueSurfaceProps) {
  const queue = playback.queue;
  const queueCommands = playback.queueCommands;

  return (
    <QueuePanel
      open={queue.open}
      panelRef={focus.panelRef}
      finalFocus={focus.controlRef}
      queue={queue.queue}
      currentIndex={queue.currentIndex}
      currentTrack={queue.currentTrack}
      hasDeferredTracks={queue.hasDeferredTracks}
      radioTimeline={queue.currentRadioTimeline}
      playbackClock={playback.playbackClock}
      playing={playback.transport.playing}
      onPlay={queueCommands.playQueueIndex}
      onRemove={queueCommands.removeQueueItem}
      onClear={onClear}
      onShuffle={queueCommands.shuffleQueue}
      onMove={queueCommands.moveQueueItem}
      onArtist={navigation.onArtist}
      onAlbum={navigation.onAlbum}
      onNowPlaying={navigation.onNowPlaying}
      onRadioSeries={navigation.onRadioSeries}
      onOpenRadioItem={navigation.onOpenRadioItem}
      getRadioChapterLocalLinks={getRadioChapterLocalLinks}
      onSeek={playback.transportCommands.seek}
      recommendation={recommendation.state.value}
      recommendationLoading={recommendationPlayLoading}
      recommendationQueueLoading={recommendation.state.queueLoading}
      onQueueRecommendation={() => {
        void recommendation.commands.addToQueue();
      }}
      onPlayRecommendation={recommendation.commands.play}
      onAnotherRecommendation={recommendation.commands.showAnother}
      onRecommendationAlbum={navigation.onRecommendationAlbum}
      loadingAlbumId={loadingAlbumId}
      playerVisible={playerVisible}
    />
  );
}
