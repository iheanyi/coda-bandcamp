import { memo } from "react";

import { CoverArt } from "@/features/artwork/CoverArt";
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
      album={{
        id: track.albumId,
        title: current?.title ?? track.album,
        artist: current?.artist ?? track.artist,
        coverArt: track.coverArt,
        artworkUrl: current?.artworkUrl ?? track.artworkUrl,
        palette: track.palette,
      }}
      animateChanges={Boolean(track.radioChapters?.length)}
      className={className}
      fallbackArtworkUrl={current?.artworkUrl ? track.artworkUrl : undefined}
      size="large"
    />
  );
});
