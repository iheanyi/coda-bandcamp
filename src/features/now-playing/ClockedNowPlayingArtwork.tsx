import { memo } from "react";

import { CoverArt } from "@/features/artwork/CoverArt";
import {
  coverArtAlbumFromTrack,
  coverArtFallbackFromTrack,
} from "@/features/artwork/coverArtAlbum";
import { useCurrentRadioChapter } from "@/features/player/playbackClockHooks";
import type { PlaybackClock } from "@/playbackClock";
import type { RadioChapter, Track } from "@/types";

export type ClockedNowPlayingArtworkProps = Readonly<{
  className?: string;
  playbackClock: PlaybackClock;
  radioTimeline: readonly RadioChapter[];
  track: Track;
}>;

/** Keeps chapter artwork in sync without subscribing the App composition root. */
export const ClockedNowPlayingArtwork = memo(function ClockedNowPlayingArtwork({
  className,
  playbackClock,
  radioTimeline,
  track,
}: ClockedNowPlayingArtworkProps) {
  const { current } = useCurrentRadioChapter(playbackClock, radioTimeline);

  return (
    <CoverArt
      album={coverArtAlbumFromTrack(track, current)}
      animateChanges={Boolean(track.radioChapters?.length)}
      className={className}
      fallbackArtworkUrl={coverArtFallbackFromTrack(track, current)}
      size="large"
    />
  );
});
