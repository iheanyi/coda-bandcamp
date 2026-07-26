import { beforeEach, describe, expect, it } from "vitest";
import {
  LOCAL_FAVORITES_KEY,
  readLocalFavorites,
  repairLocalFavoriteMetadata,
  updateLocalFavorites,
  writeLocalFavorites,
} from "./localFavorites";
import type { Album, Track } from "./types";

const track: Track = {
  id: "song-1",
  title: "Mirage",
  artist: "Sweeps",
  album: "Mirage",
  albumId: "album-1",
  duration: 188,
  track: 1,
  coverArt: "cover-1",
  artworkUrl: "https://bandcamp.com/api/subsonic/rest/getCoverArt.view?t=signed",
  streamUrl: "https://bandcamp.com/api/subsonic/rest/stream.view?t=signed",
  palette: ["#a66", "#222"],
};

const album: Album = {
  id: "album-1",
  title: "Mirage",
  artist: "Sweeps",
  songCount: 1,
  duration: 188,
  coverArt: "cover-1",
  artworkUrl: "https://bandcamp.com/api/subsonic/rest/getCoverArt.view?t=signed",
  tracks: [track],
  palette: ["#a66", "#222"],
};

beforeEach(() => {
  window.localStorage.clear();
});

describe("local favorites", () => {
  it("persists bounded metadata without signed URLs or embedded tracks", () => {
    let favorites = updateLocalFavorites(
      { albumIds: [], songIds: [], albums: [], tracks: [] },
      { id: album.id, kind: "album", favorite: true },
      album,
    );
    favorites = updateLocalFavorites(
      favorites,
      { id: track.id, kind: "song", favorite: true },
      track,
    );

    writeLocalFavorites(favorites);

    const serialized = window.localStorage.getItem(LOCAL_FAVORITES_KEY)!;
    expect(serialized).not.toContain("stream.view");
    expect(serialized).not.toContain("getCoverArt.view");
    expect(readLocalFavorites()).toMatchObject({
      albumIds: ["album-1"],
      songIds: ["song-1"],
      albums: [{ id: "album-1", coverArt: "cover-1" }],
      tracks: [{ id: "song-1", coverArt: "cover-1" }],
    });
    expect(readLocalFavorites().albums[0]).not.toHaveProperty("tracks");
  });

  it("removes favorites and discards malformed storage", () => {
    const added = updateLocalFavorites(
      { albumIds: [], songIds: [], albums: [], tracks: [] },
      { id: track.id, kind: "song", favorite: true },
      track,
    );
    expect(updateLocalFavorites(
      added,
      { id: track.id, kind: "song", favorite: false },
    ).songIds).toEqual([]);

    window.localStorage.setItem(LOCAL_FAVORITES_KEY, "{\"version\":1,\"songIds\":\"bad\"}");
    expect(readLocalFavorites()).toEqual({
      albumIds: [],
      songIds: [],
      albums: [],
      tracks: [],
    });
    expect(window.localStorage.getItem(LOCAL_FAVORITES_KEY)).toBeNull();
  });

  it("normalizes nullable native fields and repairs prior ID-only favorites", () => {
    const nativeAlbum = {
      ...album,
      coverArt: null,
      year: null,
      genre: null,
      addedAt: null,
    } as unknown as Album;
    const nativeTrack = {
      ...track,
      coverArt: null,
      disc: null,
    } as unknown as Track;
    const repaired = repairLocalFavoriteMetadata(
      {
        albumIds: ["album-1"],
        songIds: ["song-1"],
        albums: [],
        tracks: [],
      },
      [nativeAlbum],
      [nativeTrack],
    );

    expect(repaired.albums).toMatchObject([{ id: "album-1" }]);
    expect(repaired.tracks).toMatchObject([{ id: "song-1" }]);
    expect(repaired.albums[0]).not.toHaveProperty("coverArt");
    expect(repaired.tracks[0]).not.toHaveProperty("disc");
    expect(() => writeLocalFavorites(repaired)).not.toThrow();
  });
});
