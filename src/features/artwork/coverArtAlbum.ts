import type { Track } from "@/types";

import type { CoverArtAlbum } from "./CoverArt";

type CoverArtChapterOverlay = {
  title?: string;
  artist?: string;
  artworkUrl?: string;
};

export function coverArtAlbumFromTrack(
  track: Track,
  chapter?: CoverArtChapterOverlay,
): CoverArtAlbum {
  return {
    id: track.albumId,
    title: chapter?.title ?? track.album,
    artist: chapter?.artist ?? track.artist,
    coverArt: track.coverArt,
    artworkUrl: chapter?.artworkUrl ?? track.artworkUrl,
    palette: track.palette,
  };
}

export function coverArtFallbackFromTrack(
  track: Track,
  chapter?: CoverArtChapterOverlay,
): string | undefined {
  return chapter?.artworkUrl ? track.artworkUrl : undefined;
}
