import { afterEach, describe, expect, it } from "vitest";
import { hydrateAlbum, readLibraryCache, writeLibraryCache } from "./lib";

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

  it("strips signed artwork and track media from new cache entries", () => {
    let serialized = "";
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          setItem: (_key: string, value: string) => {
            serialized = value;
          },
        },
        requestIdleCallback: (callback: () => void) => callback(),
      },
    });
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

    writeLibraryCache([{
      ...album,
      credentials: "must-not-persist",
      streamUrl: "https://bandcamp.com/api/subsonic/stream?s=salt&t=token",
    } as typeof album]);

    expect(serialized).not.toContain("artworkUrl");
    expect(serialized).not.toContain("tracks");
    expect(serialized).not.toContain("streamUrl");
    expect(serialized).not.toContain("credentials");
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
