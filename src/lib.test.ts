import { afterEach, describe, expect, it } from "vitest";
import { hydrateAlbum, readLibraryCache } from "./lib";

const originalWindow = globalThis.window;

afterEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: originalWindow,
  });
});

function installStorage(value: string | null) {
  let removed = false;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: () => value,
        removeItem: () => {
          removed = true;
        },
      },
    },
  });
  return () => removed;
}

describe("library metadata cache", () => {
  it("returns valid cached albums without network access", () => {
    const album = hydrateAlbum({
      id: "album-1",
      title: "Test Release",
      artist: "Test Artist",
      songCount: 2,
      duration: 300,
    });
    installStorage(JSON.stringify({ savedAt: 1_000, albums: [album] }));

    expect(readLibraryCache(1_001)).toEqual([album]);
  });

  it("strips signed artwork and tracks from legacy cache entries", () => {
    const album = hydrateAlbum({
      id: "album-1",
      title: "Test Release",
      artist: "Test Artist",
      songCount: 1,
      duration: 180,
      artworkUrl: "https://bandcamp.com/api/subsonic/getCoverArt?s=salt&t=token",
      tracks: [
        {
          id: "track-1",
          title: "Test Track",
          artist: "Test Artist",
          album: "Test Release",
          albumId: "album-1",
          duration: 180,
          track: 1,
          streamUrl: "https://bandcamp.com/api/subsonic/stream?s=salt&t=token",
          palette: ["#cf6046", "#2f2624"],
        },
      ],
    });
    installStorage(JSON.stringify({
      savedAt: 1_000,
      albums: [{
        ...album,
        credentials: "must-not-survive",
        streamUrl: "https://bandcamp.com/api/subsonic/stream?s=salt&t=token",
      }],
    }));

    expect(readLibraryCache(1_001)).toEqual([
      expect.not.objectContaining({
        artworkUrl: expect.anything(),
        credentials: expect.anything(),
        streamUrl: expect.anything(),
        tracks: expect.anything(),
      }),
    ]);
  });

  it("preserves validated Subsonic and OpenSubsonic album dates", () => {
    const album = hydrateAlbum({
      id: "album-dates",
      title: "Dated Release",
      artist: "Test Artist",
      songCount: 1,
      duration: 180,
      addedAt: "30 Jun 2025 12:00:00 GMT",
      starredAt: "2025-07-01T12:00:00Z",
      playedAt: "2025-07-02T12:00:00Z",
      originalReleaseDate: { year: 2001 },
      releaseDate: { year: 2025, month: 6, day: 30 },
    });
    installStorage(JSON.stringify({ savedAt: 1_000, albums: [album] }));

    expect(readLibraryCache(1_001)).toEqual([album]);
  });

  it("drops malformed optional release dates without discarding the album", () => {
    const album = hydrateAlbum({
      id: "album-malformed-date",
      title: "Still Playable",
      artist: "Test Artist",
      songCount: 1,
      duration: 180,
    });
    installStorage(
      JSON.stringify({
        savedAt: 1_000,
        albums: [
          {
            ...album,
            originalReleaseDate: {},
            releaseDate: { year: 2025, month: 2, day: 29 },
          },
        ],
      }),
    );

    expect(readLibraryCache(1_001)).toEqual([album]);
  });

  it("discards expired cache entries", () => {
    const wasRemoved = installStorage(JSON.stringify({ savedAt: 0, albums: [] }));

    expect(readLibraryCache(8 * 24 * 60 * 60 * 1_000)).toEqual([]);
    expect(wasRemoved()).toBe(true);
  });

  it("ignores malformed cached data", () => {
    installStorage(JSON.stringify({ savedAt: 1_000, albums: [{ id: "partial" }] }));

    expect(readLibraryCache(1_001)).toEqual([]);
  });
});
