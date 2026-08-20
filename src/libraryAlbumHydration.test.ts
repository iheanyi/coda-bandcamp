import { describe, expect, it } from "vitest";
import {
  albumWithRecoveredCover,
  albumWithTracks,
} from "./libraryAlbumHydration";
import type { Album, Track } from "./types";

const album: Album = {
  id: "album-1",
  title: "Glass",
  artist: "Night Archive",
  songCount: 2,
  duration: 360,
  palette: ["#111", "#222"],
};

const tracks: Track[] = [
  {
    id: "track-1",
    title: "Afterimage",
    artist: album.artist,
    album: album.title,
    albumId: album.id,
    duration: 180,
    track: 1,
    palette: album.palette,
    coverArt: "cover-1",
  },
  {
    id: "track-2",
    title: "Halo",
    artist: album.artist,
    album: album.title,
    albumId: album.id,
    duration: 180,
    track: 2,
    palette: album.palette,
  },
];

describe("library album hydration", () => {
  it("copies tracks and recovers cover art from the tracklist", () => {
    const hydrated = albumWithTracks(album, tracks);
    expect(hydrated.coverArt).toBe("cover-1");
    expect(hydrated.tracks).toEqual(tracks);
    expect(hydrated.tracks).not.toBe(tracks);
  });

  it("leaves albums that already have cover art unchanged", () => {
    const covered = { ...album, coverArt: "kept" };
    expect(albumWithRecoveredCover(covered, tracks)).toBe(covered);
  });
});
