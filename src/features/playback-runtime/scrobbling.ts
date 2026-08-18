import { normalizedReleaseTitle } from "@/playerState";
import {
  advanceRadioScrobblingWithTimeline,
  completeRadioShowScrobble,
  createRadioScrobbleProgress,
  markRadioChapterScrobble,
  markRadioShowScrobble,
  radioChapterTimelineFromBounded,
  type RadioScrobbleAction,
} from "@/radioScrobbling";
import type {
  LastFmPlaybackProgress,
  LastFmTrackInput,
  PlayerStateSnapshot,
  RadioChapter,
  RadioScrobbleProgress,
  Track,
} from "@/types";

import { safePlaybackErrorDetail } from "./errors";
import type { PlaybackNotify, PlaybackScrobbleAdapters } from "./types";

type PlaybackSession = {
  trackId: string;
  startedAt: number;
  listenedSeconds: number;
  lastPosition: number;
  nowPlayingSent: boolean;
  scrobbleState: "idle" | "pending" | "sent" | "failed";
};

type ScrobbleEnvironment = {
  connected: boolean;
  notify: PlaybackNotify;
};

const emptyPlaybackSession = (positionSeconds = 0): PlaybackSession => ({
  trackId: "",
  startedAt: 0,
  listenedSeconds: 0,
  lastPosition: positionSeconds,
  nowPlayingSent: false,
  scrobbleState: "idle",
});

function lastFmTrackInput(track: Track): LastFmTrackInput {
  const input: LastFmTrackInput = {
    artist: track.artist,
    title: track.title,
    album: normalizedReleaseTitle(track.album),
    duration: Math.max(0, Math.floor(track.duration)),
    trackNumber: Math.max(0, Math.floor(track.track)),
    chosenByUser: true,
  };
  if (track.albumArtist) input.albumArtist = track.albumArtist;
  if (track.musicBrainzId) input.musicBrainzId = track.musicBrainzId;
  return input;
}

export type PlaybackEndResult = {
  checkpointRecommended: boolean;
};

export type PlaybackScrobbleController = {
  restore: (state: PlayerStateSnapshot) => void;
  activateTrack: (track: Track | undefined, positionSeconds: number) => void;
  onPlaying: (
    track: Track,
    timeline: readonly RadioChapter[],
    positionSeconds: number,
  ) => void;
  onTimeUpdate: (
    track: Track,
    timeline: readonly RadioChapter[],
    positionSeconds: number,
    playing: boolean,
  ) => void;
  onSeek: (positionSeconds: number) => void;
  onEnded: (
    track: Track,
    timeline: readonly RadioChapter[],
    positionSeconds: number,
  ) => PlaybackEndResult;
  persistedLastFmProgress: (
    track: Track | undefined,
  ) => LastFmPlaybackProgress | undefined;
  persistedRadioProgress: (
    track: Track | undefined,
  ) => RadioScrobbleProgress | undefined;
  clear: () => void;
};

export function createPlaybackScrobbleController({
  adapters,
  getEnvironment,
}: {
  adapters: PlaybackScrobbleAdapters;
  getEnvironment: () => ScrobbleEnvironment;
}): PlaybackScrobbleController {
  let playbackSession = emptyPlaybackSession();
  let radioProgress: RadioScrobbleProgress | undefined;
  let restoredPlaybackSession: LastFmPlaybackProgress | undefined;
  let restoredRadioProgress: RadioScrobbleProgress | undefined;

  const dispatchRadioActions = (
    showTrackId: string,
    actions: readonly RadioScrobbleAction[],
  ) => {
    for (const action of actions) {
      if (action.kind === "now-playing") {
        void adapters.updateNowPlaying(action.track).catch((cause: unknown) => {
          getEnvironment().notify(
            `Last.fm could not update this Radio chapter: ${safePlaybackErrorDetail(cause)}`,
            "bad",
          );
        });
        continue;
      }
      void adapters
        .scrobble(action.track, action.timestamp)
        .then(() => {
          if (radioProgress?.showTrackId === showTrackId) {
            radioProgress = markRadioChapterScrobble(
              radioProgress,
              action.chapterKey,
              "sent",
            );
          }
        })
        .catch((cause: unknown) => {
          if (radioProgress?.showTrackId === showTrackId) {
            radioProgress = markRadioChapterScrobble(
              radioProgress,
              action.chapterKey,
              "failed",
            );
          }
          getEnvironment().notify(
            `Last.fm could not scrobble this Radio chapter: ${safePlaybackErrorDetail(cause)}`,
            "bad",
          );
        });
    }
  };

  const restore = (state: PlayerStateSnapshot) => {
    restoredPlaybackSession = state.lastFmProgress;
    restoredRadioProgress = state.radioScrobbleProgress
      ? {
          ...state.radioScrobbleProgress,
          scrobbledChapterKeys: [
            ...state.radioScrobbleProgress.scrobbledChapterKeys,
          ],
        }
      : undefined;
  };

  const activateTrack = (track: Track | undefined, positionSeconds: number) => {
    if (track?.id.startsWith("radio:")) {
      radioProgress =
        restoredRadioProgress?.showTrackId === track.id
          ? { ...restoredRadioProgress, lastPosition: positionSeconds }
          : createRadioScrobbleProgress(track.id, positionSeconds);
      restoredRadioProgress = undefined;
      playbackSession = emptyPlaybackSession(positionSeconds);
      return;
    }
    radioProgress = undefined;
    if (track && restoredPlaybackSession?.trackId === track.id) {
      playbackSession = {
        ...restoredPlaybackSession,
        startedAt: 0,
        nowPlayingSent: false,
        lastPosition: positionSeconds,
      };
      restoredPlaybackSession = undefined;
      return;
    }
    playbackSession = {
      ...emptyPlaybackSession(positionSeconds),
      trackId: track?.id ?? "",
    };
  };

  const onPlaying = (
    track: Track,
    timeline: readonly RadioChapter[],
    positionSeconds: number,
  ) => {
    const environment = getEnvironment();
    if (track.id.startsWith("radio:")) {
      const progress =
        radioProgress ?? createRadioScrobbleProgress(track.id, positionSeconds);
      const advanced = advanceRadioScrobblingWithTimeline(
        track,
        radioChapterTimelineFromBounded(track, timeline),
        progress,
        positionSeconds,
        true,
        environment.connected,
        adapters.nowSeconds(),
      );
      radioProgress = advanced.progress;
      dispatchRadioActions(track.id, advanced.actions);
      return;
    }

    const session = playbackSession;
    if (session.trackId !== track.id) return;
    if (!session.startedAt) session.startedAt = adapters.nowSeconds();
    if (!environment.connected || session.nowPlayingSent) return;
    session.nowPlayingSent = true;
    void adapters
      .updateNowPlaying(lastFmTrackInput(track))
      .catch((cause: unknown) => {
        if (playbackSession === session) {
          getEnvironment().notify(
            `Last.fm could not update Now Playing: ${safePlaybackErrorDetail(cause)}`,
            "bad",
          );
        }
      });
  };

  const onTimeUpdate = (
    track: Track,
    timeline: readonly RadioChapter[],
    positionSeconds: number,
    playing: boolean,
  ) => {
    const environment = getEnvironment();
    if (track.id.startsWith("radio:")) {
      const progress =
        radioProgress ?? createRadioScrobbleProgress(track.id, positionSeconds);
      const advanced = advanceRadioScrobblingWithTimeline(
        track,
        radioChapterTimelineFromBounded(track, timeline),
        progress,
        positionSeconds,
        playing,
        environment.connected,
        adapters.nowSeconds(),
      );
      radioProgress = advanced.progress;
      dispatchRadioActions(track.id, advanced.actions);
      return;
    }

    const session = playbackSession;
    if (session.trackId !== track.id) return;
    const delta = positionSeconds - session.lastPosition;
    session.lastPosition = positionSeconds;
    if (playing && delta > 0 && delta <= 10) {
      session.listenedSeconds += delta;
    }
    const threshold = Math.min(track.duration / 2, 240);
    if (
      !environment.connected ||
      track.duration <= 30 ||
      !session.startedAt ||
      session.listenedSeconds < threshold ||
      session.scrobbleState !== "idle"
    ) {
      return;
    }

    session.scrobbleState = "pending";
    void adapters
      .scrobble(lastFmTrackInput(track), session.startedAt)
      .then(() => {
        if (playbackSession === session) session.scrobbleState = "sent";
      })
      .catch((cause: unknown) => {
        if (playbackSession === session) {
          session.scrobbleState = "failed";
          getEnvironment().notify(
            `Last.fm could not scrobble this track: ${safePlaybackErrorDetail(cause)}`,
            "bad",
          );
        }
      });
  };

  const onSeek = (positionSeconds: number) => {
    playbackSession.lastPosition = positionSeconds;
    if (radioProgress) {
      radioProgress = { ...radioProgress, lastPosition: positionSeconds };
    }
  };

  const onEnded = (
    track: Track,
    timeline: readonly RadioChapter[],
    positionSeconds: number,
  ): PlaybackEndResult => {
    if (!track.id.startsWith("radio:")) {
      return { checkpointRecommended: false };
    }
    const environment = getEnvironment();
    const progress =
      radioProgress ?? createRadioScrobbleProgress(track.id, positionSeconds);
    const advanced = advanceRadioScrobblingWithTimeline(
      track,
      radioChapterTimelineFromBounded(track, timeline),
      progress,
      positionSeconds,
      true,
      environment.connected,
      adapters.nowSeconds(),
    );
    dispatchRadioActions(track.id, advanced.actions);
    const completed = completeRadioShowScrobble(
      track,
      advanced.progress,
      environment.connected,
    );
    radioProgress = completed.progress;
    if (completed.action) {
      const showTrackId = track.id;
      void adapters
        .scrobble(completed.action.track, completed.action.timestamp)
        .then(() => {
          if (radioProgress?.showTrackId === showTrackId) {
            radioProgress = markRadioShowScrobble(radioProgress, "sent");
          }
        })
        .catch((cause: unknown) => {
          if (radioProgress?.showTrackId === showTrackId) {
            radioProgress = markRadioShowScrobble(radioProgress, "failed");
          }
          getEnvironment().notify(
            `Last.fm could not scrobble this completed Radio show: ${safePlaybackErrorDetail(cause)}`,
            "bad",
          );
        });
    }
    return {
      checkpointRecommended:
        Boolean(completed.action) ||
        advanced.actions.some((action) => action.kind === "chapter-scrobble"),
    };
  };

  const persistedLastFmProgress = (
    track: Track | undefined,
  ): LastFmPlaybackProgress | undefined => {
    if (
      !track ||
      track.id.startsWith("radio:") ||
      playbackSession.trackId !== track.id
    ) {
      return undefined;
    }
    return { ...playbackSession };
  };

  const persistedRadioProgress = (
    track: Track | undefined,
  ): RadioScrobbleProgress | undefined => {
    if (
      !track?.id.startsWith("radio:") ||
      radioProgress?.showTrackId !== track.id
    ) {
      return undefined;
    }
    return {
      ...radioProgress,
      scrobbledChapterKeys: [...radioProgress.scrobbledChapterKeys],
    };
  };

  const clear = () => {
    playbackSession = emptyPlaybackSession();
    radioProgress = undefined;
    restoredPlaybackSession = undefined;
    restoredRadioProgress = undefined;
  };

  return {
    restore,
    activateTrack,
    onPlaying,
    onTimeUpdate,
    onSeek,
    onEnded,
    persistedLastFmProgress,
    persistedRadioProgress,
    clear,
  };
}
