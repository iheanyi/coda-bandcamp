import {
  checkpointPlayerState,
  clearPlayerState,
  fetchCoverUrl,
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
    listen<SystemMediaControlEvent>(
      "coda://system-media-control",
      ({ payload }) => {
        if (payload.action === "play") handlers.onPlay();
        if (payload.action === "pause") handlers.onPause();
        if (payload.action === "previous") handlers.onPrevious();
        if (payload.action === "next") handlers.onNext();
        if (
          payload.action === "seek" &&
          typeof payload.positionSeconds === "number"
        ) {
          handlers.onSeek(payload.positionSeconds);
        }
      },
    ),
  ]);
}

export const defaultPlaybackSystemMediaAdapters: PlaybackSystemMediaAdapters = {
  fetchCoverUrl,
  createArtworkDataUrl: createSystemArtworkDataUrl,
  syncBrowserPlayback: syncMediaSessionPlayback,
  installBrowserHandlers: installMediaSessionTrackHandlers,
  updateNativeMetadata: updateSystemMediaMetadata,
  updateNativePlayback: updateSystemMediaPlayback,
  updateNativeTimeline: updateSystemMediaTimeline,
  installDesktopControls,
};
