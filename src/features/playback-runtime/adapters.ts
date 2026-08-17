import {
  checkpointPlayerState,
  clearPlayerState,
  fetchStreamUrl,
  invalidateStreamUrl,
  isDesktop,
  loadPlayerState,
  recordPlaybackDiagnostic,
  savePlayerState,
  scrobbleLastFm,
  updateLastFmNowPlaying,
  updateSystemMediaMetadata,
  updateSystemMediaPlayback,
  updateSystemMediaTimeline,
} from "@/lib";
import { coverArtSource } from "@/coverArtSource";
import { refreshDailyTrack } from "@/daily";
import {
  installMediaSessionTrackHandlers,
  syncMediaSessionPlayback,
} from "@/media";
import {
  isNumberValue,
  isStringValue,
  projectOwnDataRecord,
} from "@/ownData";
import { createSystemArtworkDataUrl } from "@/systemArtwork";

import type {
  DesktopPlaybackControlHandlers,
  PlaybackAudioAdapters,
  PlaybackPersistenceAdapters,
  PlaybackScrobbleAdapters,
  PlaybackSystemMediaAdapters,
} from "./types";

export const defaultPlaybackPersistenceAdapters: PlaybackPersistenceAdapters = {
  load: loadPlayerState,
  save: savePlayerState,
  checkpoint: checkpointPlayerState,
  clear: clearPlayerState,
};

export const defaultPlaybackAudioAdapters: Omit<
  PlaybackAudioAdapters,
  "loadRadioShow"
> = {
  fetchStreamUrl,
  invalidateStreamUrl,
  loadDailyTrack: refreshDailyTrack,
  recordDiagnostic: recordPlaybackDiagnostic,
};

export const defaultPlaybackScrobbleAdapters: PlaybackScrobbleAdapters = {
  updateNowPlaying: updateLastFmNowPlaying,
  scrobble: scrobbleLastFm,
  nowSeconds: () => Math.floor(Date.now() / 1_000),
};

type DesktopListenerDisposer = () => void | Promise<void>;

type SystemMediaTransportControlEvent =
  | { action: "play" }
  | { action: "pause" }
  | { action: "previous" }
  | { action: "next" };

type SystemMediaSeekControlEvent = {
  action: "seek";
  positionSeconds: number;
};

export type ParsedSystemMediaControlEvent =
  | SystemMediaTransportControlEvent
  | SystemMediaSeekControlEvent;

export function parseSystemMediaControlEvent<Value>(
  payload: Value,
): ParsedSystemMediaControlEvent | undefined {
  const record = projectOwnDataRecord(payload);
  if (record === undefined) return undefined;

  const action = record.action;
  if (!isStringValue(action)) return undefined;

  switch (action) {
    case "play":
      return { action: "play" };
    case "pause":
      return { action: "pause" };
    case "previous":
      return { action: "previous" };
    case "next":
      return { action: "next" };
    case "seek": {
      const positionSeconds = record.positionSeconds;
      if (!isNumberValue(positionSeconds) || !Number.isFinite(positionSeconds)) {
        return undefined;
      }
      return { action: "seek", positionSeconds };
    }
    default:
      return undefined;
  }
}

export function dispatchSystemMediaControlEvent<Value>(
  handlers: DesktopPlaybackControlHandlers,
  payload: Value,
): void {
  const event = parseSystemMediaControlEvent(payload);
  if (!event) return;
  switch (event.action) {
    case "play":
      handlers.onPlay();
      return;
    case "pause":
      handlers.onPause();
      return;
    case "previous":
      handlers.onPrevious();
      return;
    case "next":
      handlers.onNext();
      return;
    case "seek":
      handlers.onSeek(event.positionSeconds);
      return;
    default: {
      const unhandledEvent: never = event;
      return unhandledEvent;
    }
  }
}

function disposeDesktopListeners(
  disposers: readonly DesktopListenerDisposer[],
): void {
  for (const dispose of disposers) {
    try {
      void Promise.resolve(dispose()).catch(() => undefined);
    } catch {
      // A rebuilding WebView can remove listeners before React cleanup.
    }
  }
}

/**
 * Treats the native listener pair atomically. If either registration fails,
 * any sibling that succeeded is immediately uninstalled.
 */
export async function collectDesktopListenerCleanup(
  registrations: readonly Promise<DesktopListenerDisposer>[],
): Promise<() => void> {
  const settled = await Promise.allSettled(registrations);
  const disposers = settled.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  const failed = settled.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failed) {
    disposeDesktopListeners(disposers);
    throw failed.reason;
  }
  return () => disposeDesktopListeners(disposers);
}

async function installDesktopControls(
  handlers: DesktopPlaybackControlHandlers,
): Promise<() => void> {
  if (!isDesktop()) return () => undefined;
  const { listen } = await import("@tauri-apps/api/event");
  return collectDesktopListenerCleanup([
    listen<unknown>("coda://tray-control", ({ payload }) => {
      if (payload === "play") handlers.onPlay();
      if (payload === "pause") handlers.onPause();
      if (payload === "play-pause") handlers.onTogglePlayback();
      if (payload === "previous") handlers.onPrevious();
      if (payload === "next") handlers.onNext();
      if (payload === "shuffle-library") void handlers.onShuffleLibrary();
    }),
    listen<unknown>(
      "coda://system-media-control",
      ({ payload }) => {
        dispatchSystemMediaControlEvent(handlers, payload);
      },
    ),
  ]);
}

export const defaultPlaybackSystemMediaAdapters: PlaybackSystemMediaAdapters = {
  coverArtSource,
  createArtworkDataUrl: createSystemArtworkDataUrl,
  syncBrowserPlayback: syncMediaSessionPlayback,
  installBrowserHandlers: installMediaSessionTrackHandlers,
  updateNativeMetadata: updateSystemMediaMetadata,
  updateNativePlayback: updateSystemMediaPlayback,
  updateNativeTimeline: updateSystemMediaTimeline,
  installDesktopControls,
};
