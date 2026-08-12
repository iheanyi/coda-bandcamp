import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from "react";

import { showAirPlayPicker, supportsAirPlayPicker } from "@/media";
import { boundRadioChapters, radioShowIdFromTrackId } from "@/radioPlayback";
import { radioTrackFromShow } from "@/radioTrack";
import type { Track } from "@/types";

import type { PlaybackCoreController } from "./core";
import { safePlaybackErrorDetail } from "./errors";
import type { PlaybackPersistenceController } from "./persistence";
import type { PlaybackScrobbleController } from "./scrobbling";
import type { PlaybackSystemMediaController } from "./systemMedia";
import type { PlaybackAudioAdapters, PlaybackNotify } from "./types";

const MAX_STREAM_REFRESH_ATTEMPTS = 1;

type ResolvedPlaybackStream = {
  trackId: string;
  url: string;
};

function playbackErrorMessage(code: number | undefined): string {
  if (code === 4) return "Coda could not play this stream format.";
  if (code === 2) return "Coda lost the Bandcamp stream connection.";
  if (code === 3) return "Coda could not decode this track.";
  return "Coda could not load this track.";
}

export type PlaybackAudioController = {
  element: ReactNode;
  airPlayAvailable: boolean;
  openAirPlay: () => void;
};

export function usePlaybackAudioController({
  adapters,
  connected,
  core,
  notify,
  persistence,
  scrobbling,
  systemMedia,
}: {
  adapters: PlaybackAudioAdapters;
  connected: boolean;
  core: PlaybackCoreController;
  notify: PlaybackNotify;
  persistence: PlaybackPersistenceController;
  scrobbling: PlaybackScrobbleController;
  systemMedia: PlaybackSystemMediaController;
}): PlaybackAudioController {
  const [resolvedStream, setResolvedStream] =
    useState<ResolvedPlaybackStream>();
  const [streamRequestNonce, setStreamRequestNonce] = useState(0);
  const [airPlayAvailable, setAirPlayAvailable] = useState(false);
  const streamRefreshRef = useRef({ trackId: "", attempts: 0 });
  const currentTrack = core.queueModel.currentTrack;
  const boundStreamTrackId = resolvedStream?.trackId;
  const activeStream =
    boundStreamTrackId === currentTrack?.id ? resolvedStream : undefined;
  const activationGeneration = core.snapshot.activationGeneration;
  const audioRef = core.audioRef;
  const playbackClock = core.playbackClock;
  const getCoreSnapshot = core.getSnapshot;
  const pendingPosition = core.internal.pendingPosition;
  const replaceCurrentTrack = core.internal.replaceCurrentTrack;
  const advanceAfterEnded = core.internal.advanceAfterEnded;
  const pause = core.transportCommands.pause;
  const playing = core.transportModel.playing;
  const volume = core.transportModel.volume;
  const checkpoint = persistence.checkpoint;
  const syncSystemMediaTimeline = systemMedia.syncTimeline;

  useEffect(() => {
    streamRefreshRef.current = {
      trackId: currentTrack?.id ?? "",
      attempts: 0,
    };
  }, [currentTrack?.id]);

  useEffect(() => {
    if (!currentTrack) {
      setResolvedStream(undefined);
      return;
    }
    if (currentTrack.streamUrl) {
      setResolvedStream({
        trackId: currentTrack.id,
        url: currentTrack.streamUrl,
      });
      return;
    }

    const radioShowId = radioShowIdFromTrackId(currentTrack.id);
    if (radioShowId !== undefined) {
      let active = true;
      setResolvedStream(undefined);
      void adapters
        .loadRadioShow(radioShowId)
        .then((show) => {
          if (!active) return;
          const refreshedTrack: Track = {
            ...currentTrack,
            ...radioTrackFromShow(show),
          };
          replaceCurrentTrack(currentTrack.id, refreshedTrack);
          setResolvedStream({
            trackId: currentTrack.id,
            url: show.streamUrl,
          });
        })
        .catch((cause) => {
          if (!active) return;
          pause();
          notify(
            `Coda could not resume this Radio show: ${safePlaybackErrorDetail(cause)}`,
            "bad",
          );
        });
      return () => {
        active = false;
      };
    }

    if (!connected) {
      setResolvedStream(undefined);
      return;
    }

    let active = true;
    setResolvedStream(undefined);
    adapters.recordDiagnostic("renderer.stream.request");
    void adapters
      .fetchStreamUrl(currentTrack.id)
      .then((url) => {
        if (!active) return;
        adapters.recordDiagnostic("renderer.stream.ready");
        setResolvedStream({ trackId: currentTrack.id, url });
      })
      .catch((cause) => {
        if (!active) return;
        adapters.recordDiagnostic("renderer.stream.error");
        pause();
        notify(safePlaybackErrorDetail(cause), "bad");
      });
    return () => {
      active = false;
    };
  }, [
    adapters,
    connected,
    currentTrack,
    currentTrack?.id,
    currentTrack?.streamUrl,
    notify,
    pause,
    replaceCurrentTrack,
    streamRequestNonce,
  ]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
  }, [audioRef, volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.setAttribute("x-webkit-airplay", "allow");
    const updateAvailability = () =>
      setAirPlayAvailable(supportsAirPlayPicker(audio));
    updateAvailability();
    audio.addEventListener(
      "webkitplaybacktargetavailabilitychanged",
      updateAvailability,
    );
    return () =>
      audio.removeEventListener(
        "webkitplaybacktargetavailabilitychanged",
        updateAvailability,
      );
  }, [audioRef]);

  const openAirPlay = useCallback(() => {
    if (!showAirPlayPicker(audioRef.current)) {
      notify("AirPlay is not available on this device.", "bad");
    }
  }, [audioRef, notify]);

  const handlePlaying = useCallback(() => {
    const snapshot = getCoreSnapshot();
    const track = snapshot.queue[snapshot.currentIndex];
    if (!track || boundStreamTrackId !== track.id) return;
    streamRefreshRef.current = { trackId: track.id, attempts: 0 };
    adapters.recordDiagnostic("renderer.audio.play-ready");
    const positionSeconds =
      audioRef.current?.currentTime ?? playbackClock.readExact();
    scrobbling.onPlaying(
      track,
      boundRadioChapters(track.radioChapters ?? []),
      positionSeconds,
    );
  }, [
    adapters,
    audioRef,
    boundStreamTrackId,
    getCoreSnapshot,
    playbackClock,
    scrobbling,
  ]);

  const handleSeeking = useCallback(
    (event: SyntheticEvent<HTMLAudioElement>) => {
      const snapshot = getCoreSnapshot();
      const track = snapshot.queue[snapshot.currentIndex];
      if (!track || boundStreamTrackId !== track.id) return;
      const positionSeconds = event.currentTarget.currentTime;
      playbackClock.seek(positionSeconds);
      syncSystemMediaTimeline(event.currentTarget, true);
      scrobbling.onSeek(positionSeconds);
    },
    [
      boundStreamTrackId,
      getCoreSnapshot,
      playbackClock,
      scrobbling,
      syncSystemMediaTimeline,
    ],
  );

  const handleLoadedMetadata = useCallback(
    (event: SyntheticEvent<HTMLAudioElement>) => {
      const pending = pendingPosition.current;
      const snapshot = getCoreSnapshot();
      const activeTrack = snapshot.queue[snapshot.currentIndex];
      if (
        !pending ||
        pending.trackId !== activeTrack?.id ||
        boundStreamTrackId !== activeTrack.id
      ) {
        return;
      }
      const duration = event.currentTarget.duration;
      const maximum =
        Number.isFinite(duration) && duration > 0
          ? Math.max(0, duration - 0.25)
          : pending.positionSeconds;
      const position = Math.min(Math.max(0, pending.positionSeconds), maximum);
      scrobbling.onSeek(position);
      event.currentTarget.currentTime = position;
      playbackClock.restore(position);
      syncSystemMediaTimeline(event.currentTarget, true);
      pendingPosition.current = undefined;
    },
    [
      boundStreamTrackId,
      getCoreSnapshot,
      pendingPosition,
      playbackClock,
      scrobbling,
      syncSystemMediaTimeline,
    ],
  );

  const handleTimeUpdate = useCallback(
    (event: SyntheticEvent<HTMLAudioElement>) => {
      const snapshot = getCoreSnapshot();
      const track = snapshot.queue[snapshot.currentIndex];
      if (!track || boundStreamTrackId !== track.id) return;
      const positionSeconds = event.currentTarget.currentTime;
      playbackClock.updateFromMedia(positionSeconds);
      syncSystemMediaTimeline(event.currentTarget);
      scrobbling.onTimeUpdate(
        track,
        boundRadioChapters(track.radioChapters ?? []),
        positionSeconds,
        snapshot.playing,
      );
    },
    [
      boundStreamTrackId,
      getCoreSnapshot,
      playbackClock,
      scrobbling,
      syncSystemMediaTimeline,
    ],
  );

  const handleError = useCallback(
    (event: SyntheticEvent<HTMLAudioElement>) => {
      const mediaError = event.currentTarget.error;
      adapters.recordDiagnostic("renderer.audio.media-error");
      const snapshot = getCoreSnapshot();
      const track = snapshot.queue[snapshot.currentIndex];
      if (!track || boundStreamTrackId !== track.id) return;
      const canRefreshAuthenticatedStream =
        connected &&
        !track.streamUrl &&
        !track.id.startsWith("radio:") &&
        (mediaError?.code === 2 || mediaError?.code === 4);
      if (canRefreshAuthenticatedStream) {
        const refresh = streamRefreshRef.current;
        if (refresh.trackId !== track.id) {
          refresh.trackId = track.id;
          refresh.attempts = 0;
        }
        if (refresh.attempts < MAX_STREAM_REFRESH_ATTEMPTS) {
          refresh.attempts += 1;
          adapters.invalidateStreamUrl(track.id);
          setResolvedStream(undefined);
          setStreamRequestNonce((nonce) => nonce + 1);
          return;
        }
      }
      pause();
      notify(playbackErrorMessage(mediaError?.code), "bad");
    },
    [adapters, connected, getCoreSnapshot, notify, pause, boundStreamTrackId],
  );

  const handleEnded = useCallback(
    (event: SyntheticEvent<HTMLAudioElement>) => {
      const snapshot = getCoreSnapshot();
      const track = snapshot.queue[snapshot.currentIndex];
      if (!track || boundStreamTrackId !== track.id) return;
      const result = scrobbling.onEnded(
        track,
        boundRadioChapters(track.radioChapters ?? []),
        event.currentTarget.currentTime,
      );
      if (result.checkpointRecommended) {
        void checkpoint().catch(() => {
          // The periodic checkpoint remains a fallback.
        });
      }
      advanceAfterEnded();
    },
    [
      advanceAfterEnded,
      boundStreamTrackId,
      checkpoint,
      getCoreSnapshot,
      scrobbling,
    ],
  );

  const handleDurationChange = useCallback(
    (event: SyntheticEvent<HTMLAudioElement>) => {
      const snapshot = getCoreSnapshot();
      const track = snapshot.queue[snapshot.currentIndex];
      if (!track || boundStreamTrackId !== track.id) return;
      if (!Number.isFinite(event.currentTarget.duration)) return;
      playbackClock.updateFromMedia(event.currentTarget.currentTime);
      syncSystemMediaTimeline(event.currentTarget, true);
    },
    [
      boundStreamTrackId,
      getCoreSnapshot,
      playbackClock,
      syncSystemMediaTimeline,
    ],
  );

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !activeStream) {
      return;
    }
    let active = true;
    if (playing) {
      adapters.recordDiagnostic("renderer.audio.play-request");
      void audio.play().catch((cause: unknown) => {
        const interrupted =
          cause instanceof DOMException && cause.name === "AbortError";
        if (active && !interrupted) {
          adapters.recordDiagnostic("renderer.audio.play-error");
          pause();
          notify(
            `Coda could not start playback: ${safePlaybackErrorDetail(cause)}`,
            "bad",
          );
        }
      });
    } else {
      audio.pause();
    }
    return () => {
      active = false;
    };
  }, [
    activationGeneration,
    adapters,
    audioRef,
    currentTrack?.id,
    notify,
    pause,
    playing,
    activeStream?.trackId,
    activeStream?.url,
  ]);

  return {
    airPlayAvailable,
    openAirPlay,
    element: (
      <audio
        data-coda-playback-runtime-audio
        ref={audioRef}
        src={activeStream?.url}
        preload="metadata"
        onPlaying={handlePlaying}
        onSeeking={handleSeeking}
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onError={handleError}
        onDurationChange={handleDurationChange}
        onEnded={handleEnded}
      />
    ),
  };
}
