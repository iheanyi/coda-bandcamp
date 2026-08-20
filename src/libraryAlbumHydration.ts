import type { Album, Track } from "./types";

export function albumWithTracks(
  album: Album,
  tracks: readonly Track[],
): Album {
  return {
    ...albumWithRecoveredCover(album, tracks),
    tracks: [...tracks],
  };
}

export function albumWithRecoveredCover(
  album: Album,
  tracks: readonly Track[],
): Album {
  if (album.coverArt) return album;
  const coverArt = tracks.find((track) => track.coverArt)?.coverArt;
  return coverArt ? { ...album, coverArt } : album;
}
