import { describe, expect, it } from "vitest";
import {
  parseNativeFavoriteCollection,
  parseNativeFavoriteMutationResult,
  parseNativeFavoriteTrackReconciliation,
} from "./data-bridge/favorites";

const nativeAlbum = {
  id: "album-1",
  title: "Soft Focus",
  artist: "Night Archive",
  songCount: 1,
  duration: 245,
};

const nativeTrack = {
  id: "song-1",
  title: "Afterimage",
  artist: "Night Archive",
  album: "Soft Focus",
  albumId: "album-1",
  duration: 245,
  track: 1,
};

describe("Favorites native decoders", () => {
  it("decodes bounded server-starred albums and tracks", () => {
    expect(parseNativeFavoriteCollection({
      albumIds: ["album-1"],
      songIds: ["song-1"],
      albums: [nativeAlbum],
      tracks: [nativeTrack],
    })).toEqual({
      albumIds: ["album-1"],
      songIds: ["song-1"],
      albums: [nativeAlbum],
      tracks: [nativeTrack],
    });
  });

  it("decodes accepted mutation verification without copying extra data", () => {
    expect(parseNativeFavoriteMutationResult({
      accepted: true,
      verification: "notRequired",
      favorite: false,
      credentials: "must-not-cross-the-bridge",
    })).toEqual({
      accepted: true,
      verification: "notRequired",
      favorite: false,
    });
  });

  it("decodes bounded track reconciliation results", () => {
    expect(parseNativeFavoriteTrackReconciliation({
      tracks: [{
        ...nativeTrack,
        starredAt: "2026-08-12T18:01:00Z",
      }],
      unstarredIds: ["song-2"],
      unavailableTrackCount: 1,
    })).toEqual({
      tracks: [{
        ...nativeTrack,
        starredAt: "2026-08-12T18:01:00Z",
      }],
      unstarredIds: ["song-2"],
      unavailableTrackCount: 1,
    });
  });

  it("fails closed on rejected or oversized native values", () => {
    expect(() => parseNativeFavoriteMutationResult({
      accepted: false,
      verification: "notRequired",
    })).toThrow("set_favorite.accepted");
    expect(() => parseNativeFavoriteCollection({
      albumIds: ["a".repeat(513)],
      songIds: [],
      albums: [],
      tracks: [],
    })).toThrow("fetch_favorites.albumIds[0]");
  });
});
