import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { normalizedReleaseTitle } from "@/playerState";
import { nextRadioChapterIndex, radioAiringIndexesAt } from "@/radioPlayback";
import type { Album, RadioChapter, Track } from "@/types";
import { useCoverArtSource } from "@/coverArtSource";

import type { PlaybackCoreController } from "./core";
import { safePlaybackErrorDetail } from "./errors";
import type {
  DesktopPlaybackControlHandlers,
  PlaybackNotify,
  PlaybackSystemMediaAdapters,
} from "./types";

const SYSTEM_MEDIA_TIMELINE_UPDATE_MS = 5_000;
const SYSTEM_ARTWORK_IDLE_TIMEOUT_MS = 250;

type IdleWindow = Window & {
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout: number },
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

type SystemMediaEnvironment = {
  track?: Track;
  timeline: readonly RadioChapter[];
  album?: Album;
  coverArtworkUrl?: string;
  playing: boolean;
  canNext: boolean;
};

type SystemMediaDisplay = {
  identity: string;
  title: string;
  artist: string;
  album: string;
  palette: [string, string];
  artworkUrl?: string;
  coverArtId?: string;
  nativeCanNext: boolean;
};

type CurrentSystemMedia = {
  display?: SystemMediaDisplay;
  browserArtworkUrl?: string;
  nativeArtwork?:
    { kind: "cover"; coverArtId: string } | { kind: "remote"; url: string };
};

function displayAt(
  environment: SystemMediaEnvironment,
  positionSeconds: number,
): SystemMediaDisplay | undefined {
  const track = environment.track;
  if (!track) return undefined;
  const currentIndex = radioAiringIndexesAt(
    environment.timeline,
    positionSeconds,
  ).currentIndex;
  const chapter =
    currentIndex >= 0 ? environment.timeline[currentIndex] : undefined;
  const coverArtId =
    environment.timeline.length > 0
      ? undefined
      : (track.coverArt ?? environment.album?.coverArt);
  const directArtworkUrl =
    chapter?.artworkUrl ??
    (coverArtId
      ? environment.coverArtworkUrl
      : (track.artworkUrl ?? environment.album?.artworkUrl));
  return {
    identity: [
      track.id,
      chapter?.timecode ?? "track",
      directArtworkUrl ?? "",
      coverArtId ?? "",
    ].join(":"),
    title: chapter?.title ?? track.title,
    artist: chapter?.artist ?? track.artist,
    album: chapter?.album ?? normalizedReleaseTitle(track.album),
    palette: track.palette,
    artworkUrl: directArtworkUrl,
    coverArtId,
    nativeCanNext:
      environment.canNext ||
      (currentIndex >= 0 &&
        nextRadioChapterIndex(currentIndex, environment.timeline.length) >= 0),
  };
}

type SystemMediaCoordinator = {
  syncAt: (positionSeconds: number, force?: boolean) => void;
  syncPlayback: (positionSeconds: number) => void;
  syncTimeline: (audio: HTMLAudioElement, force?: boolean) => void;
  dispose: () => void;
};

function createSystemMediaCoordinator({
  adapters,
  getEnvironment,
  reportNativeError,
}: {
  adapters: PlaybackSystemMediaAdapters;
  getEnvironment: () => SystemMediaEnvironment;
  reportNativeError: (cause: unknown) => void;
}): SystemMediaCoordinator {
  let current: CurrentSystemMedia = {};
  let artworkGeneration = 0;
  let lastTimelineUpdate = Number.NEGATIVE_INFINITY;
  let cancelGeneratedArtwork: (() => void) | undefined;

  const cancelPendingGeneratedArtwork = () => {
    cancelGeneratedArtwork?.();
    cancelGeneratedArtwork = undefined;
  };

  const syncBrowser = (positionSeconds: number) => {
    const environment = getEnvironment();
    const display = current.display;
    adapters.syncBrowserPlayback({
      title: display?.title,
      artist: display?.artist,
      album: display?.album,
      artworkUrl: current.browserArtworkUrl,
      playing: environment.playing,
      positionSeconds,
      durationSeconds: environment.track?.duration,
    });
  };

  const syncNativeMetadata = () => {
    const display = current.display;
    if (!display) {
      void adapters.updateNativeMetadata().catch(reportNativeError);
      return;
    }
    void adapters
      .updateNativeMetadata({
        title: display.title,
        artist: display.artist,
        album: display.album,
        artwork: current.nativeArtwork,
        canPrevious: true,
        canNext: display.nativeCanNext,
      })
      .catch(reportNativeError);
  };

  const installDisplay = (
    display: SystemMediaDisplay | undefined,
    positionSeconds: number,
  ) => {
    cancelPendingGeneratedArtwork();
    artworkGeneration += 1;
    const generation = artworkGeneration;
    if (!display) {
      current = {};
      syncBrowser(positionSeconds);
      syncNativeMetadata();
      return;
    }
    current = {
      display,
      browserArtworkUrl: display.artworkUrl,
      nativeArtwork: display.coverArtId
        ? { kind: "cover", coverArtId: display.coverArtId }
        : display.artworkUrl
          ? { kind: "remote", url: display.artworkUrl }
          : undefined,
    };
    syncBrowser(positionSeconds);
    syncNativeMetadata();

    if (!current.browserArtworkUrl) {
      let active = true;
      const generateArtwork = () => {
        if (
          !active ||
          generation !== artworkGeneration ||
          current.display?.identity !== display.identity ||
          current.browserArtworkUrl
        ) {
          return;
        }
        const artworkUrl = adapters.createArtworkDataUrl({
          title: display.title,
          artist: display.artist,
          album: display.album,
          palette: display.palette,
        });
        if (
          !artworkUrl ||
          !active ||
          generation !== artworkGeneration ||
          current.display?.identity !== display.identity ||
          current.browserArtworkUrl
        ) {
          return;
        }
        current = { ...current, browserArtworkUrl: artworkUrl };
        syncBrowser(positionSeconds);
      };
      const idleWindow: IdleWindow = window;
      if (idleWindow.requestIdleCallback) {
        const handle = idleWindow.requestIdleCallback(generateArtwork, {
          timeout: SYSTEM_ARTWORK_IDLE_TIMEOUT_MS,
        });
        cancelGeneratedArtwork = () => {
          active = false;
          idleWindow.cancelIdleCallback?.(handle);
        };
      } else {
        const timer = window.setTimeout(generateArtwork, 0);
        cancelGeneratedArtwork = () => {
          active = false;
          window.clearTimeout(timer);
        };
      }
    }
  };

  const syncAt = (positionSeconds: number, force = false) => {
    const display = displayAt(getEnvironment(), positionSeconds);
    if (!force && display?.identity === current.display?.identity) return;
    installDisplay(display, positionSeconds);
  };

  const syncPlayback = (positionSeconds: number) => {
    syncAt(positionSeconds);
    syncBrowser(positionSeconds);
    void adapters
      .updateNativePlayback(getEnvironment().playing)
      .catch(reportNativeError);
  };

  const syncTimeline = (audio: HTMLAudioElement, force = false) => {
    syncAt(audio.currentTime);
    const durationSeconds = Number.isFinite(audio.duration)
      ? audio.duration
      : (getEnvironment().track?.duration ?? 0);
    if (durationSeconds <= 0) return;
    const now = performance.now();
    if (!force && now - lastTimelineUpdate < SYSTEM_MEDIA_TIMELINE_UPDATE_MS) {
      return;
    }
    lastTimelineUpdate = now;
    void adapters
      .updateNativeTimeline(audio.currentTime, durationSeconds)
      .catch(reportNativeError);
  };

  return {
    syncAt,
    syncPlayback,
    syncTimeline,
    dispose: () => {
      cancelPendingGeneratedArtwork();
      artworkGeneration += 1;
    },
  };
}

export type PlaybackSystemMediaController = {
  syncTimeline: (audio: HTMLAudioElement, force?: boolean) => void;
};

export function usePlaybackSystemMediaController({
  adapters,
  albums,
  core,
  notify,
  onShuffleEntireLibrary,
}: {
  adapters: PlaybackSystemMediaAdapters;
  albums: readonly Album[];
  core: PlaybackCoreController;
  notify: PlaybackNotify;
  onShuffleEntireLibrary?: () => void | Promise<void>;
}): PlaybackSystemMediaController {
  const currentAlbum = useMemo(
    () =>
      core.queueModel.currentTrack
        ? albums.find(
            (album) => album.id === core.queueModel.currentTrack?.albumId,
          )
        : undefined,
    [albums, core.queueModel.currentTrack],
  );
  const currentCoverArtId =
    core.queueModel.currentRadioTimeline.length > 0
      ? undefined
      : (core.queueModel.currentTrack?.coverArt ?? currentAlbum?.coverArt);
  const subscribedCoverArtworkUrl = useCoverArtSource(currentCoverArtId);
  const coverArtworkUrl = currentCoverArtId
    ? (subscribedCoverArtworkUrl ?? adapters.coverArtSource(currentCoverArtId))
    : undefined;
  const environmentRef = useRef<SystemMediaEnvironment>({
    track: core.queueModel.currentTrack,
    timeline: core.queueModel.currentRadioTimeline,
    album: currentAlbum,
    coverArtworkUrl,
    playing: core.transportModel.playing,
    canNext: core.transportModel.canNext,
  });
  environmentRef.current = {
    track: core.queueModel.currentTrack,
    timeline: core.queueModel.currentRadioTimeline,
    album: currentAlbum,
    coverArtworkUrl,
    playing: core.transportModel.playing,
    canNext: core.transportModel.canNext,
  };
  const nativeErrorNotifiedRef = useRef(false);
  const reportNativeError = useCallback(
    (cause: unknown) => {
      if (nativeErrorNotifiedRef.current) return;
      nativeErrorNotifiedRef.current = true;
      console.error(
        "Windows media controls could not start.",
        safePlaybackErrorDetail(cause),
      );
      notify(
        "Windows media controls could not start. Quit Coda from the tray and reopen it.",
        "bad",
      );
    },
    [notify],
  );
  const [coordinator] = useState(() =>
    createSystemMediaCoordinator({
      adapters,
      getEnvironment: () => environmentRef.current,
      reportNativeError,
    }),
  );

  useEffect(() => {
    coordinator.syncAt(core.playbackClock.readExact(), true);
  }, [
    coordinator,
    core.playbackClock,
    core.queueModel.currentRadioTimeline,
    core.queueModel.currentTrack,
    core.transportModel.canNext,
    coverArtworkUrl,
    currentAlbum,
  ]);

  useEffect(() => {
    coordinator.syncPlayback(core.playbackClock.readExact());
  }, [coordinator, core.playbackClock, core.transportModel.playing]);

  const handlerRef = useRef<DesktopPlaybackControlHandlers>({
    onPlay: core.transportCommands.play,
    onPause: core.transportCommands.pause,
    onTogglePlayback: core.transportCommands.toggle,
    onPrevious: core.transportCommands.previous,
    onNext: core.transportCommands.next,
    onSeek: core.internal.seekFromSystemMedia,
    onShuffleLibrary: onShuffleEntireLibrary ?? (() => undefined),
  });
  handlerRef.current = {
    onPlay: core.transportCommands.play,
    onPause: core.transportCommands.pause,
    onTogglePlayback: core.transportCommands.toggle,
    onPrevious: core.transportCommands.previous,
    onNext: core.transportCommands.next,
    onSeek: core.internal.seekFromSystemMedia,
    onShuffleLibrary: onShuffleEntireLibrary ?? (() => undefined),
  };

  useEffect(
    () =>
      adapters.installBrowserHandlers({
        onPlay: () => handlerRef.current.onPlay(),
        onPause: () => handlerRef.current.onPause(),
        onPreviousTrack: () => handlerRef.current.onPrevious(),
        onNextTrack: () => handlerRef.current.onNext(),
      }),
    [adapters],
  );

  useEffect(() => {
    let disposed = false;
    let uninstall: () => void = () => undefined;
    void adapters
      .installDesktopControls({
        onPlay: () => handlerRef.current.onPlay(),
        onPause: () => handlerRef.current.onPause(),
        onTogglePlayback: () => handlerRef.current.onTogglePlayback(),
        onPrevious: () => handlerRef.current.onPrevious(),
        onNext: () => handlerRef.current.onNext(),
        onSeek: (positionSeconds) => handlerRef.current.onSeek(positionSeconds),
        onShuffleLibrary: () => handlerRef.current.onShuffleLibrary(),
      })
      .then((dispose) => {
        if (disposed) {
          dispose();
        } else {
          uninstall = dispose;
        }
      })
      .catch(() => {
        // Native controls are optional; the in-window player remains available.
      });
    return () => {
      disposed = true;
      try {
        uninstall();
      } catch {
        // A rebuilding WebView may already have removed native listeners.
      }
    };
  }, [adapters]);

  useEffect(() => () => coordinator.dispose(), [coordinator]);

  return {
    syncTimeline: useCallback(
      (audio: HTMLAudioElement, force = false) =>
        coordinator.syncTimeline(audio, force),
      [coordinator],
    ),
  };
}
