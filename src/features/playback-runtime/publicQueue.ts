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
  const publicQueueTrack: PlaybackQueueTrack = {
    ...publicTrack,
    palette: [track.palette[0], track.palette[1]],
  };
  if (radioChapters) {
    publicQueueTrack.radioChapters = radioChapters.map(publicRadioChapter);
  }
  if (discoverRelease) {
    publicQueueTrack.discoverRelease = publicDiscoverRelease(discoverRelease);
  }
  return publicQueueTrack;
}

/**
 * Queue mutations preserve unchanged Track objects. Reuse their stripped
 * projections so appending or reordering does not clone the entire queue's
 * metadata or change the current track's identity. Weak keys release entries
 * when the private track leaves the runtime; replacements get fresh projections.
 */
export function createPublicPlaybackQueueProjector(): (
  track: Track,
) => PlaybackQueueTrack {
  const projections = new WeakMap<Track, PlaybackQueueTrack>();
  return (track) => {
    const existing = projections.get(track);
    if (existing) return existing;
    const projection = publicPlaybackQueueTrack(track);
    projections.set(track, projection);
    return projection;
  };
}
