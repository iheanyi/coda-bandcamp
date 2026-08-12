import { useMemo, type RefObject } from "react";

import type { ToastNotifier } from "@/components/ui/toastManager";
import { CoverArt } from "@/features/artwork/CoverArt";
import type { FavoritesController } from "@/features/favorites/useLocalFavoritesController";
import type { LibraryRouteRuntime } from "@/features/library/LibraryRouteRuntime";
import type { LibraryWorkspaceController } from "@/features/library/useLibraryWorkspaceController";
import { useLibraryRouteRuntimeAdapter } from "@/features/library/useLibraryRouteRuntimeAdapter";
import type { LibraryActionsController } from "@/features/library-actions/useLibraryActionsController";
import type { CodaNavigationController } from "@/features/navigation/useCodaNavigationController";
import { ClockedNowPlayingArtwork } from "@/features/now-playing/ClockedNowPlayingArtwork";
import type { NowPlayingRuntimeValue } from "@/features/now-playing/NowPlayingRuntimeContext";
import { useNowPlayingRuntimeAdapter } from "@/features/now-playing/useNowPlayingRuntimeAdapter";
import type { PlaybackRuntimeController } from "@/features/playback-runtime/types";
import type { QueueRecommendationController } from "@/features/queue/useQueueRecommendationController";
import type { DiscoverRuntimeValue } from "@/features/discover/DiscoverRuntimeContext";
import { useDiscoverRuntimeAdapter } from "@/features/discover/useDiscoverRuntimeAdapter";
import type { RadioRuntimeValue } from "@/features/radio/RadioRuntimeContext";
import { useRadioRuntimeAdapter } from "@/features/radio/useRadioRuntimeAdapter";
import type { SavedLibraryRuntimeValue } from "@/features/saved-library/SavedLibraryRuntimeContext";
import { useSavedLibraryRuntimeAdapter } from "@/features/saved-library/useSavedLibraryRuntimeAdapter";
import type { LibraryRouteInput } from "@/routing/libraryRouteInput";
import type { Album, Track } from "@/types";

type AppRoutePlaybackActions = Readonly<{
  playTrack: (track: Track) => void;
  playTracks: (tracks: Track[]) => void;
  queueTrack: (track: Track) => void;
  queueTracks: (tracks: Track[]) => void;
  toggle: () => void;
}>;

type AppRouteLibraryRuntime = Readonly<{
  actions: LibraryActionsController;
  albums: readonly Album[];
  routeInput: LibraryRouteInput;
  workspace: LibraryWorkspaceController;
}>;

type AppRouteFavoritesRuntime = Readonly<{
  controller: FavoritesController;
  onAddToPlaylist: (tracks: Track[]) => void;
  onToggleCurrent: () => void;
}>;

type AppRoutePlaybackRuntime = Readonly<{
  actions: AppRoutePlaybackActions;
  controller: PlaybackRuntimeController;
}>;

type AppRouteQueueRuntime = Readonly<{
  controlRef: RefObject<HTMLButtonElement | null>;
  recommendation: QueueRecommendationController;
}>;

export type AppRouteRuntimesOptions = Readonly<{
  favorites: AppRouteFavoritesRuntime;
  library: AppRouteLibraryRuntime;
  navigation: CodaNavigationController;
  notify: ToastNotifier;
  playback: AppRoutePlaybackRuntime;
  queue: AppRouteQueueRuntime;
}>;

export type AppRouteRuntimes = Readonly<{
  discover: DiscoverRuntimeValue;
  library: LibraryRouteRuntime;
  nowPlaying: NowPlayingRuntimeValue;
  radio: RadioRuntimeValue;
  savedLibrary: SavedLibraryRuntimeValue;
}>;

/**
 * Projects persistent application controllers into the focused interfaces
 * consumed by route screens. Route components never need to understand the
 * shell's controller graph.
 */
export function useAppRouteRuntimes({
  favorites,
  library,
  navigation,
  notify,
  playback,
  queue,
}: AppRouteRuntimesOptions): AppRouteRuntimes {
  const currentTrack = playback.controller.queue.currentTrack;
  const currentRadioTimeline = playback.controller.queue.currentRadioTimeline;
  const playing = playback.controller.transport.playing;
  const loadingAlbumId = library.actions.state.loadingAlbumId;
  const navigationCommands = navigation.commands;

  const libraryRuntime = useLibraryRouteRuntimeAdapter({
    album: {
      loadingAlbumId,
      onAddToPlaylist: favorites.onAddToPlaylist,
      onBack: navigationCommands.album.back,
    },
    artist: {
      action: library.actions.state.artistAction,
      activeShuffleArtistKey: playback.controller.shuffle.activeArtistScopeKey,
      group: library.workspace.browse.activeArtist,
      onBack: navigationCommands.artist.back,
      onPlay: library.actions.commands.playArtist,
      onQueue: library.actions.commands.queueArtist,
      onShuffle: library.actions.commands.shuffleArtist,
      routeInput: library.routeInput,
      shuffleInProgress: Boolean(playback.controller.shuffle.progress),
    },
    catalog: {
      albums: library.albums,
      selectedAlbum: library.actions.state.selectedAlbum,
    },
    favorites: favorites.controller,
    initialLoading: library.workspace.state.isInitialLoading,
    playback: {
      currentTrack,
      onPlayTrack: playback.actions.playTrack,
      onQueueTrack: playback.actions.queueTrack,
      onTogglePlayback: playback.actions.toggle,
      playing,
    },
    screens: library.workspace.screens,
  });

  const discoverRuntime = useDiscoverRuntimeAdapter({
    navigation: {
      onCloseRelease: navigationCommands.discover.back,
      onOpenArtist: navigationCommands.discover.openArtist,
      onOpenRelease: navigationCommands.discover.openRelease,
    },
    playback: {
      currentTrackId: currentTrack?.id,
      onPlay: playback.actions.playTrack,
      onQueue: playback.actions.queueTrack,
      onTogglePlayback: playback.actions.toggle,
      playing,
    },
  });

  const savedLibraryRuntime = useSavedLibraryRuntimeAdapter({
    connected: library.workspace.screens.availabilityModel.connected,
    favorites: favorites.controller,
    loadingAlbumId,
    navigation: {
      onOpenAlbum: library.actions.commands.openAlbum,
      onOpenArtist: navigationCommands.artist.openName,
      onOpenRadioSeries: navigationCommands.radio.openSeries,
      onOpenRadioShow: navigationCommands.radio.openShow,
      onOpenTrackAlbum: navigationCommands.album.openFromTrack,
    },
    onAddToPlaylist: favorites.onAddToPlaylist,
    notify,
    playback: {
      currentTrackId: currentTrack?.id,
      onPlayTrack: playback.actions.playTrack,
      onPlayTracks: playback.actions.playTracks,
      onQueueTrack: playback.actions.queueTrack,
      onQueueTracks: playback.actions.queueTracks,
      onTogglePlayback: playback.actions.toggle,
      playing,
    },
  });

  const radioRuntime = useRadioRuntimeAdapter({
    favorites: favorites.controller,
    playback: {
      currentTrackId: currentTrack?.id,
      onPlay: playback.actions.playTrack,
      onPlayAt: playback.controller.queueCommands.playTrackAt,
      onQueue: playback.actions.queueTrack,
      onTogglePlayback: playback.actions.toggle,
      playbackClock: playback.controller.playbackClock,
      playing,
    },
  });

  const recommendation = queue.recommendation.state.value;
  const nowPlayingRuntime = useNowPlayingRuntimeAdapter({
    albumLoadingId: loadingAlbumId,
    artwork: currentTrack ? (
      <ClockedNowPlayingArtwork
        playbackClock={playback.controller.playbackClock}
        radioTimeline={currentRadioTimeline}
        track={currentTrack}
      />
    ) : null,
    favorites: {
      favoriteRadioShowIds: favorites.controller.favoriteRadioShowIds,
      favoriteTrackIds: favorites.controller.favoriteTrackIds,
      onAddToPlaylist: favorites.onAddToPlaylist,
      onToggleCurrent: favorites.onToggleCurrent,
    },
    getRadioChapterLocalLinks: navigationCommands.radio.chapterLinks,
    navigation: {
      onAlbum: navigationCommands.album.openFromTrack,
      onArtist: navigationCommands.artist.openName,
      onBack: navigationCommands.nowPlaying.back,
      onRadioSeries: navigationCommands.radio.openSeries,
    },
    playback: playback.controller,
    queueControlRef: queue.controlRef,
    recommendation: {
      artwork: recommendation ? (
        <CoverArt album={recommendation.album} size="small" />
      ) : undefined,
      loading: library.actions.state.randomPickLoading,
      onAlbum: library.actions.commands.openAlbum,
      onAnother: queue.recommendation.commands.showAnother,
      onPlay: queue.recommendation.commands.play,
      onQueue: queue.recommendation.commands.addToQueue,
      queueLoading: queue.recommendation.state.queueLoading,
      value: recommendation,
    },
  });

  return useMemo(
    () => ({
      discover: discoverRuntime,
      library: libraryRuntime,
      nowPlaying: nowPlayingRuntime,
      radio: radioRuntime,
      savedLibrary: savedLibraryRuntime,
    }),
    [
      discoverRuntime,
      libraryRuntime,
      nowPlayingRuntime,
      radioRuntime,
      savedLibraryRuntime,
    ],
  );
}
