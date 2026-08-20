import { describe, expect, it } from "vitest";
import type { Track } from "@/types";
import {
  trackAlbumDestination,
  trackArtistDestination,
} from "./trackRouteDestinations";

const libraryTrack: Track = {
  album: "Soft Focus",
  albumId: "album-1",
  artist: "Night Archive",
  duration: 180,
  id: "track-1",
  palette: ["#111", "#222"],
  title: "First Light",
  track: 1,
};

describe("track route destinations", () => {
  it("models a library track with distinct album and artist identities", () => {
    expect(trackAlbumDestination(libraryTrack)).toEqual({
      albumId: "album-1",
      kind: "album",
    });
    expect(trackArtistDestination(libraryTrack)).toEqual({
      artistKey: "night archive",
      kind: "artist",
      sourceAlbumId: "album-1",
    });
  });

  it("models a Discover album internally but keeps its artist external", () => {
    const track: Track = {
      ...libraryTrack,
      albumId: "discover:release-1",
      discoverRelease: {
        artist: "Signal Garden",
        id: "discover:release-1",
        itemUrl: "https://signal-garden.bandcamp.com/album/blue-hours",
        title: "Blue Hours",
      },
      id: "discover:release-1:preview",
    };

    expect(trackAlbumDestination(track)).toEqual({
      kind: "discover-release",
      releaseId: "discover:release-1",
      release: track.discoverRelease,
    });
    expect(trackArtistDestination(track)).toEqual({
      kind: "discover-external-artist",
    });
  });

  it("models a Radio episode without turning chapter metadata into routes", () => {
    const track: Track = {
      ...libraryTrack,
      album: "The Hip Hop Show",
      albumId: "radio:979",
      artist: "Bandcamp Radio",
      id: "radio:979",
    };

    expect(trackAlbumDestination(track)).toEqual({
      kind: "radio-show",
      showId: 979,
    });
    expect(trackArtistDestination(track)).toEqual({
      kind: "radio-series",
      seriesId: 5,
    });
  });

  it("falls back from a Radio show to series or archive when the show id is missing", () => {
    const track: Track = {
      ...libraryTrack,
      album: "The Hip Hop Show",
      albumId: "radio:not-a-show",
      artist: "Bandcamp Radio",
      id: "radio:not-a-show",
    };

    expect(trackAlbumDestination(track)).toEqual({
      kind: "radio-series",
      seriesId: 5,
    });
    expect(trackAlbumDestination({ ...track, album: "Unknown Hour" })).toEqual({
      kind: "radio",
    });
  });

  it("keeps Daily releases external to the authenticated library", () => {
    const dailySource = {
      articleSlug: "night-music",
      articleTitle: "Night Music",
      articleUrl: "https://daily.bandcamp.com/lists/night-music",
      artistUrl: "https://signal-garden.bandcamp.com",
      articleSection: "lists",
      itemUrl: "https://signal-garden.bandcamp.com/album/blue-hours",
    };
    const track: Track = {
      ...libraryTrack,
      albumId: "daily:lists:a42",
      dailySource,
      id: "daily:lists:a42:7",
    };

    expect(trackAlbumDestination(track)).toEqual({
      kind: "daily-external-item",
      itemUrl: dailySource.itemUrl,
    });
    expect(trackArtistDestination(track)).toEqual({
      kind: "daily-external-artist",
    });
    expect(
      trackAlbumDestination({
        ...track,
        dailySource: { ...dailySource, itemUrl: "" },
      }),
    ).toBeUndefined();
  });

  it("refuses malformed internal identities", () => {
    expect(
      trackAlbumDestination({ ...libraryTrack, albumId: "https://example.com" }),
    ).toBeUndefined();
    expect(
      trackArtistDestination({ ...libraryTrack, artist: "" }),
    ).toBeUndefined();
  });
});
