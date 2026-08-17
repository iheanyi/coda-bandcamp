import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { InvokeArgs } from "@tauri-apps/api/core";
import { render } from "@testing-library/react";
import { useRef } from "react";
import { afterAll, beforeEach, vi } from "vitest";

import { clearRuntimeCaches } from "@/lib";
import {
  isBooleanValue,
  isNumberValue,
  isOwnDataRecord,
  type OwnDataValue,
} from "@/ownData";
import {
  installTauriEventPluginTestInternals,
  readTauriInvokeArguments,
  tauriNumber,
  tauriString,
} from "@/test/tauriInvoke";
import type {
  Album,
  DailyArticle,
  PlayerStateSnapshot,
  RadioShow,
  Track,
} from "@/types";

import { PlaybackRuntimeProvider } from "./PlaybackRuntimeProvider";
import {
  usePlaybackQueueStatus,
  usePlaybackTransportModel,
} from "./playbackRuntimeContext";
import type {
  PlaybackRuntimeController,
  PlaybackRuntimeOptions,
} from "./types";
import { usePlaybackRuntimeController } from "./usePlaybackRuntimeController";

const WINDOWS_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const originalUserAgent = Object.getOwnPropertyDescriptor(
  Navigator.prototype,
  "userAgent",
);

export const tracks: Track[] = [
  {
    id: "track-1",
    title: "First Light",
    artist: "Night Archive",
    album: "Soft Focus",
    albumId: "album-1",
    duration: 100,
    track: 1,
    streamUrl: "https://t4.bcbits.com/stream/first.mp3?signature=private",
    artworkUrl: "https://f4.bcbits.com/img/first.jpg?signature=private",
    albumArtist: "Night Archive & Guests",
    musicBrainzId: "189002e7-3285-4e2e-92a3-7f6c30d407a2",
    radioChapters: [
      {
        title: "Should not persist",
        artist: "Private",
        timecode: 0,
        artworkUrl: "https://f4.bcbits.com/img/chapter.jpg?signature=private",
      },
    ],
    discoverRelease: {
      id: "release-1",
      title: "Soft Focus",
      artist: "Night Archive",
      itemUrl: "https://night-archive.bandcamp.com/album/soft-focus",
      artworkUrl: "https://f4.bcbits.com/img/discover.jpg?signature=private",
      featuredTrack: {
        id: "track-1",
        title: "First Light",
        duration: 100,
        streamUrl: "https://t4.bcbits.com/stream/discover.mp3?signature=private",
      },
    },
    palette: ["#777", "#222"],
  },
  {
    id: "track-2",
    title: "Afterimage",
    artist: "Night Archive",
    album: "Soft Focus",
    albumId: "album-1",
    duration: 210,
    track: 2,
    streamUrl: "https://t4.bcbits.com/stream/after.mp3?signature=private",
    palette: ["#777", "#222"],
  },
];

export const album: Album = {
  id: "album-1",
  title: "Soft Focus",
  artist: "Night Archive",
  songCount: tracks.length,
  duration: tracks.reduce((total, track) => total + track.duration, 0),
  palette: ["#777", "#222"],
};

export const refreshedRadioShow: RadioShow = {
  id: 979,
  subtitle: "The Coda Broadcast",
  title: "Bandcamp Weekly",
  description: "A broadcast from Bandcamp.",
  publishedAt: "2026-07-20T12:00:00Z",
  duration: 3_600,
  streamUrl: "https://t4.bcbits.com/stream/radio-979-refreshed/mp3-128",
  artworkUrl: "https://f4.bcbits.com/img/radio-979.jpg",
  chapters: [
    { title: "Opening signal", artist: "Bandcamp Radio", timecode: 0 },
    {
      title: "Second signal",
      artist: "Night Archive",
      album: "Night Signals",
      timecode: 60,
      artworkUrl: "https://f4.bcbits.com/img/chapter-2.jpg",
    },
  ],
};

export const mocks = {
  checkpointPlayerState: vi.fn(),
  clearPlayerState: vi.fn(),
  fetchDailyArticle:
    vi.fn<(section: string, slug: string) => Promise<DailyArticle>>(),
  fetchRadioShow: vi.fn<(showId: number) => Promise<RadioShow>>(),
  fetchStreamUrl: vi.fn<(trackId: string) => Promise<string>>(),
  loadPlayerState: vi.fn<() => Promise<PlayerStateSnapshot | undefined>>(),
  savePlayerState: vi.fn(),
  scrobbleLastFm: vi.fn(),
  updateLastFmNowPlaying: vi.fn(),
  updateSystemMediaMetadata: vi.fn(),
  updateSystemMediaPlayback: vi.fn(),
  updateSystemMediaTimeline: vi.fn(),
};

class PlaybackTestMediaMetadata {
  constructor(readonly init: MediaMetadataInit) {}
}

type PlaybackTestMediaSession = {
  metadata: PlaybackTestMediaMetadata | null;
  playbackState: MediaSessionPlaybackState;
  setActionHandler: ReturnType<typeof vi.fn>;
  setPositionState: ReturnType<typeof vi.fn>;
};

export const mediaSession: PlaybackTestMediaSession = {
  metadata: null,
  playbackState: "none",
  setActionHandler: vi.fn(),
  setPositionState: vi.fn(),
};

type TauriCallback = (message: {
  event: string;
  id: number;
  payload: OwnDataValue;
}) => void;

const eventCallbacks = new Map<number, TauriCallback>();
const eventListeners = new Map<string, Set<number>>();
let nextCallbackId = 1;

type PlaybackBridgeArguments = ReturnType<typeof readTauriInvokeArguments> & {
  articleSection?: unknown;
  checkpoint?: unknown;
  durationSeconds?: unknown;
  event?: unknown;
  eventId?: unknown;
  handler?: unknown;
  playing?: unknown;
  positionSeconds?: unknown;
  slug?: unknown;
  state?: unknown;
};

function readPlaybackBridgeArguments(
  args: InvokeArgs | undefined,
): PlaybackBridgeArguments {
  const common = readTauriInvokeArguments(args);
  if (
    args === undefined ||
    Array.isArray(args) ||
    args instanceof ArrayBuffer ||
    args instanceof Uint8Array
  ) {
    return common;
  }
  return {
    ...common,
    articleSection: args.articleSection,
    checkpoint: args.checkpoint,
    durationSeconds: args.durationSeconds,
    event: args.event,
    eventId: args.eventId,
    handler: args.handler,
    playing: args.playing,
    positionSeconds: args.positionSeconds,
    slug: args.slug,
    state: args.state,
  };
}

function isScrobbleCommandInput<Value>(
  value: Value,
): value is Value & { timestamp?: unknown; track?: unknown } {
  return isOwnDataRecord(value);
}

function removeEventListener(event: string, callbackId: number): void {
  const listeners = eventListeners.get(event);
  listeners?.delete(callbackId);
  if (listeners?.size === 0) eventListeners.delete(event);
  eventCallbacks.delete(callbackId);
}

export function persistedTrack(
  track: Track,
): PlayerStateSnapshot["queue"][number] {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    albumId: track.albumId,
    duration: track.duration,
    track: track.track,
    palette: track.palette,
  };
}

export function playerState(
  queue: PlayerStateSnapshot["queue"],
  overrides: Partial<PlayerStateSnapshot> = {},
): PlayerStateSnapshot {
  return {
    version: 1,
    savedAt: Date.now(),
    queue,
    currentIndex: 0,
    positionSeconds: 0,
    volume: 0.72,
    repeatMode: "off",
    queueOpen: false,
    ...overrides,
  };
}

export function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

export function dispatchSystemMediaControl(payload: OwnDataValue): void {
  const callbackIds = [...(eventListeners.get("coda://system-media-control") ?? [])];
  for (const callbackId of callbackIds) {
    eventCallbacks.get(callbackId)?.({
      event: "coda://system-media-control",
      id: callbackId,
      payload,
    });
  }
}

export function systemMediaControlListenerCount(): number {
  return eventListeners.get("coda://system-media-control")?.size ?? 0;
}

function installPlaybackBridge(): void {
  nextCallbackId = 1;
  eventCallbacks.clear();
  eventListeners.clear();
  installTauriEventPluginTestInternals();
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {
      convertFileSrc: (path: string, protocol: string) => `${protocol}:${path}`,
      invoke: async (command: string, args?: InvokeArgs) => {
        const values = readPlaybackBridgeArguments(args);
        switch (command) {
          case "get_stream_url":
            return mocks.fetchStreamUrl(tauriString(values.trackId, "trackId"));
          case "player_state_contract_version":
            return 2;
          case "record_player_state_diagnostic":
            return undefined;
          case "load_player_state":
            return (await mocks.loadPlayerState()) ?? null;
          case "save_player_state":
            return mocks.savePlayerState(values.state);
          case "checkpoint_player_state":
            return mocks.checkpointPlayerState(values.checkpoint);
          case "clear_player_state":
            return mocks.clearPlayerState();
          case "lastfm_update_now_playing":
            return mocks.updateLastFmNowPlaying(values.input);
          case "lastfm_scrobble": {
            if (!isScrobbleCommandInput(values.input)) {
              throw new TypeError("Playback Last.fm scrobble input is invalid");
            }
            return mocks.scrobbleLastFm(
              values.input.track,
              tauriNumber(values.input.timestamp, "timestamp"),
            );
          }
          case "radio_show":
            return mocks.fetchRadioShow(tauriNumber(values.showId, "showId"));
          case "daily_article":
            return mocks.fetchDailyArticle(
              tauriString(values.articleSection, "articleSection"),
              tauriString(values.slug, "slug"),
            );
          case "update_system_media_metadata":
            return mocks.updateSystemMediaMetadata(values.input);
          case "update_system_media_playback":
            if (!isBooleanValue(values.playing)) {
              throw new TypeError("Playback native playing flag is invalid");
            }
            return mocks.updateSystemMediaPlayback(values.playing);
          case "update_system_media_timeline":
            if (
              !isNumberValue(values.positionSeconds) ||
              !isNumberValue(values.durationSeconds)
            ) {
              throw new TypeError("Playback native timeline is invalid");
            }
            return mocks.updateSystemMediaTimeline(
              values.positionSeconds,
              values.durationSeconds,
            );
          case "invalidate_cover_art":
            return { sequence: "1" };
          case "plugin:event|listen": {
            const event = tauriString(values.event, "event");
            const callbackId = tauriNumber(values.handler, "handler");
            const listeners = eventListeners.get(event) ?? new Set<number>();
            listeners.add(callbackId);
            eventListeners.set(event, listeners);
            return callbackId;
          }
          case "plugin:event|unlisten": {
            const event = tauriString(values.event, "event");
            removeEventListener(event, tauriNumber(values.eventId, "eventId"));
            return undefined;
          }
          default:
            throw new Error(`Unexpected playback command: ${command}`);
        }
      },
      transformCallback: (callback: TauriCallback) => {
        const callbackId = nextCallbackId;
        nextCallbackId += 1;
        eventCallbacks.set(callbackId, callback);
        return callbackId;
      },
      unregisterCallback: (callbackId: number) => {
        eventCallbacks.delete(callbackId);
      },
    },
  });
}

type RuntimeControllerHarness = {
  controller?: PlaybackRuntimeController;
};

function PlaybackProbe() {
  const queue = usePlaybackQueueStatus();
  const transport = usePlaybackTransportModel();
  const renderCount = useRef(0);
  renderCount.current += 1;
  return (
    <output
      data-testid="playback-probe"
      data-current-track={queue.currentTrackId ?? ""}
      data-playing={String(transport.playing)}
      data-queue-length={String(queue.length)}
      data-queue-status={JSON.stringify(queue)}
      data-ready={String(queue.ready)}
      data-render-count={String(renderCount.current)}
    />
  );
}

export function renderRuntime(
  options: Omit<PlaybackRuntimeOptions, "albums" | "notify"> & {
    notify?: PlaybackRuntimeOptions["notify"];
    prepareQueryClient?: (queryClient: QueryClient) => void;
  },
) {
  const current: RuntimeControllerHarness = {};
  const { prepareQueryClient, notify: notifyOption, ...runtimeOptions } =
    options;
  const notify = notifyOption ?? vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  prepareQueryClient?.(queryClient);
  function Harness() {
    const controller = usePlaybackRuntimeController({
      ...runtimeOptions,
      albums: [],
      notify,
    });
    current.controller = controller;
    return (
      <PlaybackRuntimeProvider controller={controller}>
        <PlaybackProbe />
      </PlaybackRuntimeProvider>
    );
  }
  const view = render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );
  return {
    ...view,
    current,
    notify,
    queryClient,
  };
}

export function controllerFrom(
  current: RuntimeControllerHarness,
): PlaybackRuntimeController {
  if (!current.controller) throw new Error("Playback controller is not ready");
  return current.controller;
}

beforeEach(() => {
  vi.mocked(HTMLMediaElement.prototype.play).mockClear();
  vi.mocked(HTMLMediaElement.prototype.pause).mockClear();
  clearRuntimeCaches();
  Object.defineProperty(Navigator.prototype, "userAgent", {
    configurable: true,
    get: () => WINDOWS_USER_AGENT,
  });
  Object.defineProperty(navigator, "mediaSession", {
    configurable: true,
    value: mediaSession,
  });
  Object.defineProperty(globalThis, "MediaMetadata", {
    configurable: true,
    value: PlaybackTestMediaMetadata,
  });
  mediaSession.metadata = null;
  mediaSession.playbackState = "none";
  mediaSession.setActionHandler.mockClear();
  mediaSession.setPositionState.mockClear();
  installPlaybackBridge();
  mocks.checkpointPlayerState.mockReset().mockResolvedValue(true);
  mocks.clearPlayerState.mockReset().mockResolvedValue(undefined);
  mocks.fetchDailyArticle.mockReset();
  mocks.fetchRadioShow.mockReset().mockResolvedValue(refreshedRadioShow);
  mocks.fetchStreamUrl
    .mockReset()
    .mockImplementation(
      async (trackId: string) =>
        `https://t4.bcbits.com/stream/${encodeURIComponent(trackId)}/mp3-128`,
    );
  mocks.loadPlayerState.mockReset().mockResolvedValue(undefined);
  mocks.savePlayerState.mockReset().mockResolvedValue(undefined);
  mocks.scrobbleLastFm.mockReset().mockResolvedValue(undefined);
  mocks.updateLastFmNowPlaying.mockReset().mockResolvedValue(undefined);
  mocks.updateSystemMediaMetadata.mockReset().mockResolvedValue(undefined);
  mocks.updateSystemMediaPlayback.mockReset().mockResolvedValue(undefined);
  mocks.updateSystemMediaTimeline.mockReset().mockResolvedValue(undefined);
});

afterAll(() => {
  if (originalUserAgent) {
    Object.defineProperty(Navigator.prototype, "userAgent", originalUserAgent);
  } else {
    Reflect.deleteProperty(Navigator.prototype, "userAgent");
  }
  Reflect.deleteProperty(window, "__TAURI_EVENT_PLUGIN_INTERNALS__");
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});
