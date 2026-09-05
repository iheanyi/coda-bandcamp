import { clearMocks } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as coverArtSource from "./coverArtSource";
import { hydrateAlbum } from "./data-bridge/hydration";
import * as libraryBridge from "./data-bridge/library";
import { readLibraryCache } from "./data-bridge/libraryCache";
import * as runtimeData from "./data-bridge/runtimeData";
import { connectBandcamp, openBandcampUrl } from "./lib";

const originalWindow = globalThis.window;

afterEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: originalWindow,
  });
  vi.restoreAllMocks();
  clearMocks();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
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

function storedLibrarySnapshot(albums: unknown[], savedAt = 1_000): string {
  return JSON.stringify({
    version: 1,
    savedAt,
    lastFullSyncAt: savedAt,
    albums,
  });
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
    installStorage(storedLibrarySnapshot([album]));

    expect(readLibraryCache(1_001)).toEqual([album]);
  });

  it("strips runtime media fields from cached albums", () => {
    const album = hydrateAlbum({
      id: "album-1",
      title: "Test Release",
      artist: "Test Artist",
      songCount: 1,
      duration: 180,
      artworkUrl:
        "https://bandcamp.com/api/subsonic/getCoverArt?s=salt&t=token",
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
    installStorage(
      storedLibrarySnapshot([
        {
          ...album,
          credentials: "must-not-survive",
          streamUrl: "https://bandcamp.com/api/subsonic/stream?s=salt&t=token",
        },
      ]),
    );

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
    installStorage(storedLibrarySnapshot([album]));

    expect(readLibraryCache(1_001)).toEqual([album]);
  });

  it("discards malformed optional release dates", () => {
    const album = hydrateAlbum({
      id: "album-malformed-date",
      title: "Still Playable",
      artist: "Test Artist",
      songCount: 1,
      duration: 180,
    });
    const wasRemoved = installStorage(
      storedLibrarySnapshot([
        {
          ...album,
          originalReleaseDate: {},
          releaseDate: { year: 2025, month: 2, day: 29 },
        },
      ]),
    );

    expect(readLibraryCache(1_001)).toEqual([]);
    expect(wasRemoved()).toBe(true);
  });

  it.each([undefined, 2])(
    "discards unsupported cache schema version %j",
    (version) => {
      const wasRemoved = installStorage(
        JSON.stringify({
          version,
          savedAt: 1_000,
          lastFullSyncAt: 1_000,
          albums: [],
        }),
      );

      expect(readLibraryCache(1_001)).toEqual([]);
      expect(wasRemoved()).toBe(true);
    },
  );

  it("discards expired cache entries", () => {
    const wasRemoved = installStorage(storedLibrarySnapshot([], 0));

    expect(readLibraryCache(8 * 24 * 60 * 60 * 1_000)).toEqual([]);
    expect(wasRemoved()).toBe(true);
  });

  it("ignores malformed cached data", () => {
    installStorage(storedLibrarySnapshot([{ id: "partial" }]));

    expect(readLibraryCache(1_001)).toEqual([]);
  });
});

describe("public barrel helpers", () => {
  it("clears native media caches and renderer cover state after connect", async () => {
    vi.spyOn(libraryBridge, "connectBandcamp").mockResolvedValue([]);
    const clearMedia = vi.spyOn(runtimeData, "clearConnectionMediaCaches");
    const clearCover = vi.spyOn(coverArtSource, "clearCoverArtRendererState");

    await expect(
      connectBandcamp({ username: "listener", password: "token" }),
    ).resolves.toEqual([]);

    expect(libraryBridge.connectBandcamp).toHaveBeenCalledOnce();
    expect(clearMedia).toHaveBeenCalledOnce();
    expect(clearCover).toHaveBeenCalledOnce();
  });

  it("opens only verified Bandcamp HTTPS links", async () => {
    const opened: string[] = [];
    vi.spyOn(window, "open").mockImplementation((url) => {
      opened.push(String(url));
      return null;
    });

    await expect(openBandcampUrl("https://example.com/album")).rejects.toThrow(
      "Coda only opens verified Bandcamp links.",
    );
    await expect(
      openBandcampUrl(
        "https://token@nightarchive.bandcamp.com/album/soft-focus",
      ),
    ).rejects.toThrow("Coda only opens verified Bandcamp links.");
    await openBandcampUrl("https://nightarchive.bandcamp.com/album/soft-focus");
    expect(opened).toEqual([
      "https://nightarchive.bandcamp.com/album/soft-focus",
    ]);
  });
});
