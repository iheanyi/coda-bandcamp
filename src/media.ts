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
  positionSeconds?: number;
  durationSeconds?: number;
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
  if (
    !("navigator" in globalThis) ||
    !("mediaSession" in globalThis.navigator)
  ) {
    return () => undefined;
  }

  const mediaSession = globalThis.navigator.mediaSession;
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
  positionSeconds,
  durationSeconds,
}: MediaSessionPlayback) {
  if (
    !("navigator" in globalThis) ||
    !("mediaSession" in globalThis.navigator)
  ) {
    return;
  }

  const mediaSession = globalThis.navigator.mediaSession;
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
  const MediaMetadataConstructor = globalThis.MediaMetadata;
  if (!(MediaMetadataConstructor instanceof Function)) return;

  try {
    const metadata: MediaMetadataInit = {
      title,
      artist,
      album,
    };
    if (artworkUrl) {
      const artwork: MediaImage = { src: artworkUrl };
      if (artworkUrl.startsWith("data:image/png;base64,")) {
        artwork.sizes = "600x600";
        artwork.type = "image/png";
      }
      metadata.artwork = [artwork];
    }
    mediaSession.metadata = new MediaMetadataConstructor(metadata);
  } catch {
    // System media metadata is optional; in-app playback remains authoritative.
  }

  if (
    !mediaSession.setPositionState ||
    !Number.isFinite(durationSeconds) ||
    !Number.isFinite(positionSeconds) ||
    !durationSeconds ||
    durationSeconds <= 0 ||
    positionSeconds === undefined ||
    positionSeconds < 0 ||
    positionSeconds > durationSeconds
  ) {
    return;
  }
  try {
    mediaSession.setPositionState({
      duration: durationSeconds,
      playbackRate: 1,
      position: positionSeconds,
    });
  } catch {
    // Position donation is optional and varies across WebKit versions.
  }
}

export function supportsAirPlayPicker(
  media: HTMLAudioElement | null,
): media is AirPlayAudioElement {
  return Boolean(
    media &&
      "webkitShowPlaybackTargetPicker" in media &&
      media.webkitShowPlaybackTargetPicker instanceof Function,
  );
}

export function showAirPlayPicker(media: HTMLAudioElement | null): boolean {
  if (!supportsAirPlayPicker(media)) return false;
  media.webkitShowPlaybackTargetPicker();
  return true;
}
