import { beforeEach, describe, expect, it } from "vitest";
import {
  emptyLocalFavorites,
  LOCAL_FAVORITES_KEY,
  readLocalFavorites,
  repairLocalFavoriteMetadata,
  updateLocalFavorites,
  updateLocalRadioFavorite,
  writeLocalFavorites,
} from "./localFavorites";
import type { Album, RadioShowSummary, Track } from "./types";

const track: Track = {
  id: "song-1",
  title: "Mirage",
  artist: "Sweeps",
  album: "Mirage",
  albumId: "album-1",
  duration: 188,
  track: 1,
  albumArtist: "Sweeps",
  musicBrainzId: "189002e7-3285-4e2e-92a3-7f6c30d407a2",
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

const radioShow: RadioShowSummary = {
  id: 979,
  subtitle: "The Hip Hop Show",
  description: "New independent hip-hop from around the world.",
  publishedAt: "24 Jul 2026 00:00:00 GMT",
  artworkUrl: "https://f4.bcbits.com/img/0046240870_10.jpg",
};

beforeEach(() => {
  window.localStorage.clear();
});

describe("local favorites", () => {
  it("persists bounded track metadata without signed media URLs", () => {
    let favorites = updateLocalFavorites(
      emptyLocalFavorites(),
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
      tracks: [{
        id: "song-1",
        coverArt: "cover-1",
        albumArtist: "Sweeps",
        musicBrainzId: "189002e7-3285-4e2e-92a3-7f6c30d407a2",
      }],
    });
    expect(readLocalFavorites().albums[0].tracks).toBeUndefined();
  });

  it("removes favorites and discards malformed storage", () => {
    const added = updateLocalFavorites(
      emptyLocalFavorites(),
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
      radioShowIds: [],
      radioShows: [],
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
        radioShowIds: [],
        radioShows: [],
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

  it("keeps album favorites metadata-only when a tracklist becomes available", () => {
    const repaired = repairLocalFavoriteMetadata(
      {
        albumIds: ["album-1"],
        songIds: [],
        albums: [{ ...album, tracks: undefined }],
        tracks: [],
        radioShowIds: [],
        radioShows: [],
      },
      [album],
      [],
    );

    expect(repaired.albums).toHaveLength(1);
    expect(repaired.albums[0].tracks).toBeUndefined();
    expect(writeLocalFavorites(repaired).albums[0].tracks).toBeUndefined();
  });

  it("strips legacy saved album tracklists on the next write", () => {
    const refreshedTrack = { ...track, title: "Mirage (Remastered)" };
    const repaired = repairLocalFavoriteMetadata(
      {
        albumIds: ["album-1"],
        songIds: [],
        albums: [album],
        tracks: [],
        radioShowIds: [],
        radioShows: [],
      },
      [{ ...album, tracks: [refreshedTrack] }],
      [],
    );

    expect(writeLocalFavorites(repaired).albums[0].tracks).toBeUndefined();
  });

  it("migrates version-one favorites without losing music metadata", () => {
    window.localStorage.setItem(
      LOCAL_FAVORITES_KEY,
      JSON.stringify({
        version: 1,
        albumIds: ["album-1"],
        songIds: [],
        albums: [album],
        tracks: [],
      }),
    );

    expect(readLocalFavorites()).toMatchObject({
      albumIds: ["album-1"],
      radioShowIds: [],
      radioShows: [],
    });
  });

  it("persists radio-show favorites without remote artwork URLs", () => {
    const favorites = updateLocalRadioFavorite(
      emptyLocalFavorites(),
      radioShow,
      true,
    );
    writeLocalFavorites(favorites);

    const serialized = window.localStorage.getItem(LOCAL_FAVORITES_KEY)!;
    expect(serialized).not.toContain("f4.bcbits.com");
    expect(readLocalFavorites().radioShows).toEqual([
      {
        id: 979,
        subtitle: "The Hip Hop Show",
        description: "New independent hip-hop from around the world.",
        publishedAt: "24 Jul 2026 00:00:00 GMT",
      },
    ]);
    expect(updateLocalRadioFavorite(favorites, radioShow, false).radioShowIds)
      .toEqual([]);
  });
});
