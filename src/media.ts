export type AirPlayAudioElement = HTMLAudioElement & {
  webkitCurrentPlaybackTargetIsWireless?: boolean;
  webkitShowPlaybackTargetPicker: () => void;
};

export type MediaSessionTrackHandlers = {
  onPlay: () => void;
  onPause: () => void;
  onPreviousTrack: () => void;
  onNextTrack: () => void;
};

export type MediaSessionPlayback = {
  title?: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
  playing: boolean;
};

const CODA_MEDIA_SESSION_ACTIONS: readonly MediaSessionAction[] = [
  "play",
  "pause",
  "seekbackward",
  "seekforward",
  "previoustrack",
  "nexttrack",
];

function trySetMediaSessionAction(
  mediaSession: MediaSession,
  action: MediaSessionAction,
  handler: MediaSessionActionHandler | null,
) {
  try {
    mediaSession.setActionHandler(action, handler);
  } catch {
    // WebKit versions differ in which Media Session actions they expose.
  }
}

export function installMediaSessionTrackHandlers({
  onPlay,
  onPause,
  onPreviousTrack,
  onNextTrack,
}: MediaSessionTrackHandlers): () => void {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
    return () => undefined;
  }

  const mediaSession = navigator.mediaSession;
  trySetMediaSessionAction(mediaSession, "seekbackward", null);
  trySetMediaSessionAction(mediaSession, "seekforward", null);
  trySetMediaSessionAction(mediaSession, "play", () => onPlay());
  trySetMediaSessionAction(mediaSession, "pause", () => onPause());
  trySetMediaSessionAction(mediaSession, "previoustrack", () =>
    onPreviousTrack(),
  );
  trySetMediaSessionAction(mediaSession, "nexttrack", () => onNextTrack());

  return () => {
    for (const action of CODA_MEDIA_SESSION_ACTIONS) {
      trySetMediaSessionAction(mediaSession, action, null);
    }
  };
}

export function syncMediaSessionPlayback({
  title,
  artist,
  album,
  artworkUrl,
  playing,
}: MediaSessionPlayback) {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
    return;
  }

  const mediaSession = navigator.mediaSession;
  try {
    mediaSession.playbackState = title
      ? playing
        ? "playing"
        : "paused"
      : "none";
  } catch {
    // Some WebKit builds expose Media Session without writable playback state.
  }

  if (!title) {
    mediaSession.metadata = null;
    return;
  }
  if (typeof MediaMetadata !== "function") return;

  try {
    mediaSession.metadata = new MediaMetadata({
      title,
      artist,
      album,
      ...(artworkUrl ? { artwork: [{ src: artworkUrl }] } : {}),
    });
  } catch {
    // Native media metadata is optional; in-app playback remains authoritative.
  }
}

export function supportsAirPlayPicker(
  media: HTMLAudioElement | null,
): media is AirPlayAudioElement {
  return Boolean(
    media &&
      typeof (media as AirPlayAudioElement).webkitShowPlaybackTargetPicker ===
        "function",
  );
}

export function showAirPlayPicker(media: HTMLAudioElement | null): boolean {
  if (!supportsAirPlayPicker(media)) return false;
  media.webkitShowPlaybackTargetPicker();
  return true;
}
