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
