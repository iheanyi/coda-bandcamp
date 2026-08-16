import { describe, expect, it } from "vitest";
import {
  parseNativeOptionalPlaylistDetail,
  parseNativePlaylistDetail,
  parseNativePlaylists,
  parseNativePlaylistSummary,
} from "./data-bridge/playlists";

const nativePlaylist = {
  id: "playlist-1",
  name: "Night drives",
  songCount: 1,
  duration: 245,
};

describe("playlist native decoders", () => {
  it("returns null when Bandcamp committed an empty playlist update", () => {
    expect(parseNativeOptionalPlaylistDetail(null)).toBeNull();
  });

  it("decodes bounded playlist detail returned with a committed update", () => {
    expect(parseNativePlaylistDetail({
      ...nativePlaylist,
      tracks: [{
        id: "song-1",
        title: "Afterimage",
        artist: "Night Archive",
        album: "Soft Focus",
        albumId: "album-1",
        duration: 245,
        track: 1,
      }],
      credentials: "must-not-cross-the-bridge",
    })).toEqual({
      id: "playlist-1",
      name: "Night drives",
      songCount: 1,
      duration: 245,
      tracks: [{
        id: "song-1",
        title: "Afterimage",
        artist: "Night Archive",
        album: "Soft Focus",
        albumId: "album-1",
        duration: 245,
        track: 1,
      }],
    });
  });

  it("bounds playlist lists and required detail fields", () => {
    expect(parseNativePlaylists([nativePlaylist])).toEqual([nativePlaylist]);
    expect(() => parseNativePlaylists(
      Array.from({ length: 5_001 }, () => nativePlaylist),
    )).toThrow("at most 5000 entries");
    expect(() => parseNativePlaylistDetail({
      ...nativePlaylist,
      tracks: [{}],
    })).toThrow("playlist detail.tracks[0].id");
  });

  it("ignores inherited playlist fields and does not invoke accessors", () => {
    let getterCalls = 0;
    const accessorPlaylist = { ...nativePlaylist };
    Object.defineProperty(accessorPlaylist, "id", {
      configurable: true,
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("playlist getter must not run");
      },
    });
    Object.defineProperty(Object.prototype, "id", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: "polluted-playlist",
    });
    try {
      expect(() => parseNativePlaylistSummary({
        name: nativePlaylist.name,
        songCount: nativePlaylist.songCount,
        duration: nativePlaylist.duration,
      })).toThrow("Invalid native response for playlist.id");
      expect(() => parseNativePlaylistSummary(accessorPlaylist)).toThrow(
        "Invalid native response for playlist.id",
      );
      expect(() => parseNativePlaylistDetail(Object(1))).toThrow(
        "Invalid native response for playlist detail",
      );
      expect(() => parseNativePlaylistSummary({
        ...nativePlaylist,
        id: "https://bandcamp.com/playlist/one",
      })).toThrow("a bounded non-URL identifier");
      expect(() => parseNativePlaylistSummary({
        ...nativePlaylist,
        id: " playlist-1",
      })).toThrow("a bounded non-URL identifier");
      expect(() => parseNativePlaylistSummary({
        ...nativePlaylist,
        id: "//bandcamp.com/playlist/one",
      })).toThrow("a bounded non-URL identifier");
      expect(getterCalls).toBe(0);
    } finally {
      Reflect.deleteProperty(Object.prototype, "id");
    }
  });
});
