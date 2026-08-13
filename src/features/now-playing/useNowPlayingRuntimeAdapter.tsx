import { useMemo, type ReactNode } from "react";

import type { RadioChapterLocalLinks } from "@/RadioChapterMetadata";
import type { PlaybackRuntimeController } from "@/features/playback-runtime/types";
import type { NowPlayingViewProps } from "@/NowPlayingView";
import type { QueueRecommendation } from "@/queueRecommendation";
import { radioShowIdFromTrackId } from "@/radioPlayback";
import {
  missingRouteResource,
  pendingRouteResource,
  readyRouteResource,
} from "@/routing/routeResource";
import type { Album, RadioChapter, Track } from "@/types";

import type { NowPlayingRuntimeValue } from "./NowPlayingRuntimeContext";

export type NowPlayingNavigationRuntime = Pick<
  NowPlayingViewProps,
  "onAlbum" | "onArtist" | "onBack" | "onRadioSeries"
>;

export type NowPlayingFavoritesRuntime = Readonly<{
  favoriteRadioShowIds: ReadonlySet<number>;
  favoriteTrackIds: ReadonlySet<string>;
  onAddToPlaylist: (tracks: Track[]) => void;
  onToggleCurrent: () => void;
}>;

export type NowPlayingRecommendationRuntime = Readonly<{
  artwork?: ReactNode;
  loading: boolean;
  onAlbum?: (album: Album, trigger: HTMLAnchorElement) => void | Promise<void>;
  onAnother: () => void;
  onPlay: () => void;
  onQueue?: () => void | Promise<void>;
  queueLoading?: boolean;
  value?: QueueRecommendation;
}>;

export type NowPlayingRuntimeAdapterOptions = Readonly<{
  albumLoadingId?: string;
  artwork: ReactNode;
  favorites: NowPlayingFavoritesRuntime;
  getRadioChapterLocalLinks?: (chapter: RadioChapter) => RadioChapterLocalLinks;
  navigation: NowPlayingNavigationRuntime;
  playback: PlaybackRuntimeController;
  queueControlRef?: NowPlayingViewProps["queueControlRef"];
  recommendation: NowPlayingRecommendationRuntime;
}>;

/** Maps the persistent playback controller into the route's ready-state resource. */
export function useNowPlayingRuntimeAdapter({
  albumLoadingId,
  artwork,
  favorites,
  getRadioChapterLocalLinks,
  navigation,
  playback,
  queueControlRef,
  recommendation,
}: NowPlayingRuntimeAdapterOptions): NowPlayingRuntimeValue {
  const {
    currentIndex,
    currentRadioTimeline,
    currentTrack,
    hasDeferredTracks,
    open: queueOpen,
    queue,
    ready,
  } = playback.queue;
  const { airPlayAvailable, canNext, canPrevious, playing, repeat, volume } =
    playback.transport;
  const { playQueueIndex } = playback.queueCommands;
  const { cycleRepeat, next, openAirPlay, previous, seek, setVolume, toggle } =
    playback.transportCommands;
  const {
    favoriteRadioShowIds,
    favoriteTrackIds,
    onAddToPlaylist,
    onToggleCurrent,
  } = favorites;
  const { onAlbum, onArtist, onBack, onRadioSeries } = navigation;
  const {
    artwork: recommendationArtwork,
    loading: recommendationLoading,
    onAlbum: onRecommendationAlbum,
    onAnother: onAnotherRecommendation,
    onPlay: onPlayRecommendation,
    onQueue: onQueueRecommendation,
    queueLoading: recommendationQueueLoading,
    value: recommendationValue,
  } = recommendation;

  return useMemo(() => {
    if (!ready) return pendingRouteResource();
    if (!currentTrack) return missingRouteResource();

    const currentRadioShowId = radioShowIdFromTrackId(currentTrack.id);

    return readyRouteResource({
      track: currentTrack,
      queue,
      currentIndex,
      hasDeferredTracks,
      playing,
      playbackClock: playback.playbackClock,
      radioTimeline: currentRadioTimeline,
      duration: currentTrack.duration,
      volume,
      repeat,
      artwork,
      airPlayAvailable,
      queueOpen,
      queueControlRef,
      onBack,
      onToggle: toggle,
      onPrevious: previous,
      onNext: next,
      canPrevious,
      canNext,
      onSeek: seek,
      onVolume: setVolume,
      onRepeat: cycleRepeat,
      onAirPlay: openAirPlay,
      onArtist,
      onAlbum,
      albumLoading: albumLoadingId === currentTrack.albumId,
      onPlayQueueIndex: playQueueIndex,
      onRadioSeries,
      recommendation: recommendationValue,
      recommendationArtwork,
      recommendationLoading,
      recommendationQueueLoading,
      onRecommendationAlbum: onRecommendationAlbum
        ? (album, trigger) => {
            void onRecommendationAlbum(album, trigger);
          }
        : undefined,
      onQueueRecommendation: onQueueRecommendation
        ? () => {
            void onQueueRecommendation();
          }
        : undefined,
      onPlayRecommendation,
      onAnotherRecommendation,
      getRadioChapterLocalLinks,
      favorite:
        currentRadioShowId !== undefined
          ? favoriteRadioShowIds.has(currentRadioShowId)
          : favoriteTrackIds.has(currentTrack.id),
      onToggleFavorite: currentTrack.id.startsWith("daily:")
        ? undefined
        : onToggleCurrent,
      onAddToPlaylist:
        currentRadioShowId === undefined &&
        !currentTrack.id.startsWith("daily:")
          ? () => onAddToPlaylist([currentTrack])
          : undefined,
    });
  }, [
    airPlayAvailable,
    albumLoadingId,
    artwork,
    canNext,
    canPrevious,
    currentIndex,
    currentRadioTimeline,
    currentTrack,
    cycleRepeat,
    favoriteRadioShowIds,
    favoriteTrackIds,
    getRadioChapterLocalLinks,
    hasDeferredTracks,
    next,
    onAddToPlaylist,
    onAlbum,
    onAnotherRecommendation,
    onArtist,
    onBack,
    onPlayRecommendation,
    onQueueRecommendation,
    onRadioSeries,
    onRecommendationAlbum,
    onToggleCurrent,
    openAirPlay,
    playback.playbackClock,
    playQueueIndex,
    playing,
    previous,
    queue,
    queueControlRef,
    queueOpen,
    ready,
    recommendationArtwork,
    recommendationLoading,
    recommendationQueueLoading,
    recommendationValue,
    repeat,
    seek,
    setVolume,
    toggle,
    volume,
  ]);
}
