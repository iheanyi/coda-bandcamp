import { renderHook } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import type {
  PlaybackQueueTrack,
  PlaybackRuntimeController,
} from "@/features/playback-runtime/types";
import { createPlaybackClock } from "@/playbackClock";
import type { Album } from "@/types";

import {
  type NowPlayingRuntimeAdapterOptions,
  useNowPlayingRuntimeAdapter,
} from "./useNowPlayingRuntimeAdapter";

const track: PlaybackQueueTrack = {
  id: "track-1",
  title: "Glass Lines",
  artist: "Signal Garden",
  album: "Blue Hours",
  albumId: "album-1",
  duration: 201,
  track: 1,
  palette: ["#777", "#222"],
};

const recommendationAlbum: Album = {
  id: "album-2",
  title: "Night Geometry",
  artist: "Signal Garden",
  songCount: 2,
  duration: 402,
  palette: ["#555", "#111"],
};

function playbackController(
  currentTrack: PlaybackQueueTrack | undefined,
  ready = true,
): PlaybackRuntimeController {
  return {
    queue: {
      queue: currentTrack ? [currentTrack] : [],
      currentIndex: currentTrack ? 0 : -1,
      currentTrack,
      currentRadioTimeline: [],
      open: true,
      ready,
      hasDeferredTracks: false,
    },
    transport: {
      playing: true,
      volume: 0.75,
      repeat: "all",
      canPrevious: true,
      canNext: false,
      airPlayAvailable: true,
    },
    queueCommands: {
      playTrack: vi.fn(),
      playTrackAt: vi.fn(),
      playTracks: vi.fn(),
      queueTrack: vi.fn(),
      queueTracks: vi.fn(),
      playQueueIndex: vi.fn(),
      removeQueueItem: vi.fn(),
      clearQueue: vi.fn(),
      shuffleQueue: vi.fn(),
      moveQueueItem: vi.fn(),
      setOpen: vi.fn(),
    },
    transportCommands: {
      toggle: vi.fn(),
      play: vi.fn(),
      pause: vi.fn(),
      previous: vi.fn(),
      next: vi.fn(),
      seek: vi.fn(),
      setVolume: vi.fn(),
      cycleRepeat: vi.fn(),
      openAirPlay: vi.fn(),
    },
    sessionCommands: {
      checkpoint: vi.fn(async () => true),
      clear: vi.fn(async () => undefined),
      reset: vi.fn(),
      setReady: vi.fn(),
    },
    shuffle: {
      activeArtistScopeKey: undefined,
      progress: undefined,
      hasMore: false,
      cancel: vi.fn(),
      shuffle: vi.fn(),
    },
    playbackClock: createPlaybackClock(32),
    audioElement: null,
  };
}

function adapterOptions(
  playback: PlaybackRuntimeController,
): NowPlayingRuntimeAdapterOptions {
  return {
    albumLoadingId: track.albumId,
    artwork: <span data-testid="artwork" />,
    favorites: {
      favoriteRadioShowIds: new Set<number>(),
      favoriteTrackIds: new Set([track.id]),
      onAddToPlaylist: vi.fn(),
      onToggleCurrent: vi.fn(),
    },
    getRadioChapterLocalLinks: vi.fn(() => ({})),
    navigation: {
      onAlbum: vi.fn(),
      onArtist: vi.fn(),
      onBack: vi.fn(),
      onRadioSeries: vi.fn(),
    },
    playback,
    queueControlRef: createRef<HTMLButtonElement>(),
    recommendation: {
      artwork: <span data-testid="recommendation-artwork" />,
      loading: false,
      onAlbum: vi.fn(async () => undefined),
      onAnother: vi.fn(),
      onPlay: vi.fn(),
      onQueue: vi.fn(async () => undefined),
      queueLoading: true,
      value: {
        album: recommendationAlbum,
        reason: "A fresh turn from your collection",
      },
    },
  };
}

describe("useNowPlayingRuntimeAdapter", () => {
  it("returns pending until restore completes and not-found without a track", () => {
    const pending = renderHook(() =>
      useNowPlayingRuntimeAdapter(
        adapterOptions(playbackController(undefined, false)),
      ),
    );
    const missing = renderHook(() =>
      useNowPlayingRuntimeAdapter(
        adapterOptions(playbackController(undefined, true)),
      ),
    );

    expect(pending.result.current.status).toBe("pending");
    expect(missing.result.current.status).toBe("not-found");
  });

  it("projects persistent playback commands into a ready route resource", () => {
    const playback = playbackController(track);
    const options = adapterOptions(playback);
    const { result } = renderHook(() => useNowPlayingRuntimeAdapter(options));

    expect(result.current.status).toBe("ready");
    if (result.current.status !== "ready") return;
    const value = result.current.value;

    expect(value).toMatchObject({
      track,
      currentIndex: 0,
      duration: track.duration,
      volume: 0.75,
      repeat: "all",
      queueOpen: true,
      favorite: true,
      albumLoading: true,
      recommendation: options.recommendation.value,
      recommendationQueueLoading: true,
    });

    value.onToggle();
    value.onPlayQueueIndex(0);
    value.onAddToPlaylist?.();
    value.onQueueRecommendation?.();
    value.onRecommendationAlbum?.(
      recommendationAlbum,
      document.createElement("a"),
    );

    expect(playback.transportCommands.toggle).toHaveBeenCalledOnce();
    expect(playback.queueCommands.playQueueIndex).toHaveBeenCalledWith(0);
    expect(options.favorites.onAddToPlaylist).toHaveBeenCalledWith([track]);
    expect(options.recommendation.onQueue).toHaveBeenCalledOnce();
    expect(options.recommendation.onAlbum).toHaveBeenCalledWith(
      recommendationAlbum,
      expect.any(HTMLAnchorElement),
    );
  });

  it("uses Radio Favorites and never exposes add-to-playlist for a show", () => {
    const radioTrack = { ...track, id: "radio:42" };
    const playback = playbackController(radioTrack);
    const options = adapterOptions(playback);
    const radioOptions: NowPlayingRuntimeAdapterOptions = {
      ...options,
      favorites: {
        ...options.favorites,
        favoriteRadioShowIds: new Set([42]),
        favoriteTrackIds: new Set<string>(),
      },
    };
    const { result } = renderHook(() =>
      useNowPlayingRuntimeAdapter(radioOptions),
    );

    expect(result.current.status).toBe("ready");
    if (result.current.status !== "ready") return;
    expect(result.current.value.favorite).toBe(true);
    expect(result.current.value.onAddToPlaylist).toBeUndefined();
  });
});
