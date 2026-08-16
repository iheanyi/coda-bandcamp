import {
  checkpointPlayerState,
  clearPlayerState,
  fetchRadioShow,
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
  type SystemMediaControlEvent,
} from "@/lib";
import { coverArtSource } from "@/coverArtSource";
import { refreshDailyTrack } from "@/daily";
import {
  installMediaSessionTrackHandlers,
  syncMediaSessionPlayback,
} from "@/media";
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

export const defaultPlaybackAudioAdapters: PlaybackAudioAdapters = {
  fetchStreamUrl,
  invalidateStreamUrl,
  loadDailyTrack: refreshDailyTrack,
  loadRadioShow: fetchRadioShow,
  recordDiagnostic: recordPlaybackDiagnostic,
};

export const defaultPlaybackScrobbleAdapters: PlaybackScrobbleAdapters = {
  updateNowPlaying: updateLastFmNowPlaying,
  scrobble: scrobbleLastFm,
  nowSeconds: () => Math.floor(Date.now() / 1_000),
};

type DesktopListenerDisposer = () => void | Promise<void>;

type SystemMediaControlWireValue =
  | boolean
  | number
  | string
  | null
  | undefined
  | SystemMediaControlWireValue[]
  | SystemMediaControlWireRecord;

type SystemMediaControlWireRecord = {
  [key: string]: SystemMediaControlWireValue;
};

type SystemMediaNonSeekAction = Exclude<
  SystemMediaControlEvent["action"],
  "seek"
>;

export type ParsedSystemMediaControlEvent =
  | { action: SystemMediaNonSeekAction }
  | { action: "seek"; positionSeconds: number };

function isSystemMediaControlRecord<Value>(
  value: Value,
): value is Value & SystemMediaControlWireRecord {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function isPrimitiveString<Value>(value: Value): value is Value & string {
  return (
    Object.prototype.toString.call(value) === "[object String]" &&
    Object(value) !== value
  );
}

function isFinitePrimitiveNumber<Value>(
  value: Value,
): value is Value & number {
  return (
    Object.prototype.toString.call(value) === "[object Number]" &&
    Object(value) !== value &&
    Number.isFinite(value)
  );
}

export function parseSystemMediaControlEvent<Value>(
  value: Value,
): ParsedSystemMediaControlEvent | undefined {
  if (!isSystemMediaControlRecord(value) || !isPrimitiveString(value.action)) {
    return undefined;
  }
  if (value.action === "play") return { action: "play" };
  if (value.action === "pause") return { action: "pause" };
  if (value.action === "previous") return { action: "previous" };
  if (value.action === "next") return { action: "next" };
  if (
    value.action === "seek" &&
    isFinitePrimitiveNumber(value.positionSeconds)
  ) {
    return { action: "seek", positionSeconds: value.positionSeconds };
  }
  return undefined;
}

export function dispatchSystemMediaControlEvent<Value>(
  handlers: DesktopPlaybackControlHandlers,
  value: Value,
): void {
  const event = parseSystemMediaControlEvent(value);
  if (!event) return;
  if (event.action === "play") handlers.onPlay();
  if (event.action === "pause") handlers.onPause();
  if (event.action === "previous") handlers.onPrevious();
  if (event.action === "next") handlers.onNext();
  if (event.action === "seek") handlers.onSeek(event.positionSeconds);
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
    listen<string>("coda://tray-control", ({ payload }) => {
      if (payload === "play") handlers.onPlay();
      if (payload === "pause") handlers.onPause();
      if (payload === "play-pause") handlers.onTogglePlayback();
      if (payload === "previous") handlers.onPrevious();
      if (payload === "next") handlers.onNext();
      if (payload === "shuffle-library") void handlers.onShuffleLibrary();
    }),
    listen<SystemMediaControlWireValue>(
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
