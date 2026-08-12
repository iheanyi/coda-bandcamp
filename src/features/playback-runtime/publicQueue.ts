import type { Track } from "@/types";

import type {
  PlaybackQueueDiscoverRelease,
  PlaybackQueueRadioChapter,
  PlaybackQueueTrack,
} from "./types";

function publicRadioChapter(
  chapter: NonNullable<Track["radioChapters"]>[number],
): PlaybackQueueRadioChapter {
  return { ...chapter };
}

function publicDiscoverRelease(
  release: NonNullable<Track["discoverRelease"]>,
): PlaybackQueueDiscoverRelease {
  const { featuredTrack: _featuredTrack, ...publicRelease } = release;
  return publicRelease;
}

/** Projects shell visuals without exposing a playable signed stream URL. */
export function publicPlaybackQueueTrack(track: Track): PlaybackQueueTrack {
  const {
    streamUrl: _streamUrl,
    radioChapters,
    discoverRelease,
    ...publicTrack
  } = track;
  return {
    ...publicTrack,
    palette: [...track.palette],
    ...(radioChapters
      ? { radioChapters: radioChapters.map(publicRadioChapter) }
      : {}),
    ...(discoverRelease
      ? { discoverRelease: publicDiscoverRelease(discoverRelease) }
      : {}),
  };
}
