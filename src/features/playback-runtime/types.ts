import type { ReactNode } from "react";

import type { PlaybackDiagnosticEvent, SystemMediaMetadataInput } from "@/lib";
import type { MediaSessionPlayback, MediaSessionTrackHandlers } from "@/media";
import type { PlaybackClock } from "@/playbackClock";
import type {
  PlayerStateCheckpoint,
  PlayerStateInput,
  PlayerStateSnapshot,
  DiscoverRelease,
  RadioChapter,
  RadioShow,
  RepeatMode,
  Album,
  LastFmTrackInput,
  Track,
} from "@/types";
import type {
  ProgressiveLibraryShuffleController,
  ProgressiveLibraryShufflePlayerMutation,
} from "@/useProgressiveLibraryShuffle";

export type PlaybackNotificationTone = "good" | "bad";
export type PlaybackNotify = (
  message: string,
  tone?: PlaybackNotificationTone,
) => void;

export type PlaybackPersistenceAdapters = {
  load: () => Promise<PlayerStateSnapshot | undefined>;
  save: (input: PlayerStateInput) => Promise<void>;
  checkpoint: (input: PlayerStateCheckpoint) => Promise<boolean>;
  clear: () => Promise<void>;
};

export type PlaybackAudioAdapters = {
  fetchStreamUrl: (trackId: string) => Promise<string>;
  invalidateStreamUrl: (trackId: string) => void;
  loadDailyTrack: (track: Track) => Promise<Track>;
  loadRadioShow: (showId: number) => Promise<RadioShow>;
  recordDiagnostic: (event: PlaybackDiagnosticEvent) => void;
};

export type PlaybackScrobbleAdapters = {
  updateNowPlaying: (track: LastFmTrackInput) => Promise<void>;
  scrobble: (track: LastFmTrackInput, timestamp: number) => Promise<void>;
  nowSeconds: () => number;
};

export type DesktopPlaybackControlHandlers = {
  onPlay: () => void;
  onPause: () => void;
  onTogglePlayback: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSeek: (positionSeconds: number) => void;
  onShuffleLibrary: () => void | Promise<void>;
};

export type PlaybackSystemMediaAdapters = {
  fetchCoverUrl: (coverArtId: string) => Promise<string>;
  createArtworkDataUrl: (input: {
    title: string;
    artist: string;
    album: string;
    palette: [string, string];
  }) => string | undefined;
  syncBrowserPlayback: (input: MediaSessionPlayback) => void;
  installBrowserHandlers: (handlers: MediaSessionTrackHandlers) => () => void;
  updateNativeMetadata: (input?: SystemMediaMetadataInput) => Promise<void>;
  updateNativePlayback: (playing: boolean) => Promise<void>;
  updateNativeTimeline: (
    positionSeconds: number,
    durationSeconds: number,
  ) => Promise<void>;
  installDesktopControls: (
    handlers: DesktopPlaybackControlHandlers,
  ) => Promise<() => void>;
};

export type PlaybackRuntimeAdapters = {
  persistence?: Partial<PlaybackPersistenceAdapters>;
  audio?: Partial<PlaybackAudioAdapters>;
  scrobbling?: Partial<PlaybackScrobbleAdapters>;
  systemMedia?: Partial<PlaybackSystemMediaAdapters>;
};

export type ProgressivePlaybackShuffleOptions = {
  connected: boolean;
  getConnectionGeneration: () => number;
  loadAlbumTracks: (album: Album) => Promise<Track[]>;
  recoverAlbum: (album: Album, tracks: readonly Track[]) => Album;
  applyRecoveredAlbums: (albums: ReadonlyMap<string, Album>) => void;
};

export type PlaybackRuntimeOptions = {
  connected: boolean;
  lastFmConnected: boolean;
  albums: readonly Album[];
  notify: PlaybackNotify;
  progressiveShuffle?: ProgressivePlaybackShuffleOptions;
  onShuffleEntireLibrary?: () => void | Promise<void>;
  adapters?: PlaybackRuntimeAdapters;
  persistenceTiming?: {
    structuralSaveDebounceMs?: number;
    checkpointIntervalMs?: number;
  };
};

export type PlaybackQueueRadioChapter = RadioChapter;

export type PlaybackQueueDiscoverRelease = Omit<
  DiscoverRelease,
  "featuredTrack"
> & {
  featuredTrack?: never;
};

/**
 * Direct shell projection. Visual URLs stay available to the persistent
 * player, but signed stream URLs cannot leave the private audio controller.
 */
export type PlaybackQueueTrack = Omit<
  Track,
  "streamUrl" | "discoverRelease"
> & {
  streamUrl?: never;
  discoverRelease?: PlaybackQueueDiscoverRelease;
};

export type PlaybackQueueModel = {
  queue: PlaybackQueueTrack[];
  currentIndex: number;
  currentTrack?: PlaybackQueueTrack;
  currentRadioTimeline: readonly PlaybackQueueRadioChapter[];
  open: boolean;
  ready: boolean;
  hasDeferredTracks: boolean;
};

/**
 * The minimal queue projection shared through Context. Shell-only visual
 * metadata remains available only from the direct controller.
 */
export type PlaybackQueueStatus = {
  currentIndex: number;
  currentTrackId?: string;
  currentAlbumId?: string;
  length: number;
  open: boolean;
  ready: boolean;
  hasDeferredTracks: boolean;
};

export type PlaybackTransportModel = {
  playing: boolean;
  volume: number;
  repeat: RepeatMode;
  canPrevious: boolean;
  canNext: boolean;
  airPlayAvailable: boolean;
};

export type PlaybackQueueCommands = {
  playTrack: (track: Track) => void;
  playTrackAt: (track: Track, positionSeconds: number) => void;
  playTracks: (tracks: Track[]) => void;
  queueTrack: (track: Track) => void;
  queueTracks: (tracks: Track[]) => void;
  playQueueIndex: (index: number) => void;
  removeQueueItem: (index: number) => void;
  clearQueue: () => void;
  shuffleQueue: () => void;
  moveQueueItem: (from: number, to: number) => void;
  setOpen: (open: boolean) => void;
};

export type PlaybackTransportCommands = {
  toggle: () => void;
  play: () => void;
  pause: () => void;
  previous: () => void;
  next: () => void;
  seek: (positionSeconds: number) => void;
  setVolume: (volume: number) => void;
  cycleRepeat: () => void;
  openAirPlay: () => void;
};

export type PlaybackSessionCommands = {
  checkpoint: () => Promise<boolean>;
  clear: () => Promise<void>;
  reset: (options?: { ready?: boolean }) => void;
  setReady: (ready: boolean) => void;
};

export type PlaybackShuffleCommands = Pick<
  ProgressiveLibraryShuffleController,
  "activeArtistScopeKey" | "progress" | "hasMore" | "cancel" | "shuffle"
>;

export type PlaybackRuntimeController = {
  queue: PlaybackQueueModel;
  transport: PlaybackTransportModel;
  queueCommands: PlaybackQueueCommands;
  transportCommands: PlaybackTransportCommands;
  sessionCommands: PlaybackSessionCommands;
  shuffle: PlaybackShuffleCommands;
  playbackClock: PlaybackClock;
  /**
   * The persistent media element owns the signed stream URL. Callers can place
   * it in the shell, but cannot read or persist the URL through this interface.
   */
  audioElement: ReactNode;
};

export type PlaybackCoreSnapshot = {
  queue: Track[];
  currentIndex: number;
  activationGeneration: number;
  playing: boolean;
  volume: number;
  repeatMode: RepeatMode;
  queueOpen: boolean;
  ready: boolean;
};

export type PlaybackCoreMutation = (
  current: PlaybackCoreSnapshot,
) => PlaybackCoreSnapshot;

export type PlaybackProgressiveMutation =
  ProgressiveLibraryShufflePlayerMutation;
