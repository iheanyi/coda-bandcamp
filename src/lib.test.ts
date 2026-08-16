import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchDiscover } from "./data-bridge/discover";
import { hydrateAlbum } from "./data-bridge/hydration";
import { getLastFmStatus } from "./data-bridge/lastfm";
import { readLibraryCache } from "./data-bridge/libraryCache";
import { fetchRadioShow } from "./data-bridge/radio";
import { updateSystemMediaPlayback } from "./data-bridge/systemMedia";
import {
  coverCacheDiagnostics,
  fetchDiscover as fetchDiscoverFromBarrel,
  fetchRadioShow as fetchRadioShowFromBarrel,
  formatTime,
  getLastFmStatus as getLastFmStatusFromBarrel,
  initials,
  openBandcampUrl,
  updateSystemMediaPlayback as updateSystemMediaPlaybackFromBarrel,
} from "./lib";

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

function storedLibrarySnapshot(
  albums: unknown[],
  savedAt = 1_000,
): string {
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
    installStorage(storedLibrarySnapshot([{
      ...album,
      credentials: "must-not-survive",
      streamUrl: "https://bandcamp.com/api/subsonic/stream?s=salt&t=token",
    }]));

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
    const wasRemoved = installStorage(storedLibrarySnapshot([
      {
        ...album,
        originalReleaseDate: {},
        releaseDate: { year: 2025, month: 2, day: 29 },
      },
    ]));

    expect(readLibraryCache(1_001)).toEqual([]);
    expect(wasRemoved()).toBe(true);
  });

  it.each([undefined, 2])(
    "discards unsupported cache schema version %j",
    (version) => {
      const wasRemoved = installStorage(JSON.stringify({
        version,
        savedAt: 1_000,
        lastFullSyncAt: 1_000,
        albums: [],
      }));

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
  it("re-exports domain commands from the focused data-bridge modules", () => {
    expect(fetchDiscoverFromBarrel).toBe(fetchDiscover);
    expect(fetchRadioShowFromBarrel).toBe(fetchRadioShow);
    expect(getLastFmStatusFromBarrel).toBe(getLastFmStatus);
    expect(updateSystemMediaPlaybackFromBarrel).toBe(
      updateSystemMediaPlayback,
    );
  });

  it("formats playback times and two-letter initials", () => {
    expect(formatTime(-1)).toBe("0:00");
    expect(formatTime(Number.NaN)).toBe("0:00");
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(3_661)).toBe("1:01:01");
    expect(initials("soft focus extra")).toBe("SF");
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
      openBandcampUrl("https://token@nightarchive.bandcamp.com/album/soft-focus"),
    ).rejects.toThrow("Coda only opens verified Bandcamp links.");
    await openBandcampUrl("https://nightarchive.bandcamp.com/album/soft-focus");
    expect(opened).toEqual([
      "https://nightarchive.bandcamp.com/album/soft-focus",
    ]);
  });

  it("decodes native cover-cache diagnostics through the barrel", async () => {
    mockIPC((command) => {
      if (command === "cover_cache_diagnostics") {
        return {
          entryCount: 2,
          totalBytes: 1_024,
          hitCount: 8,
          missCount: 1,
          staleCount: 0,
          cleanupPending: false,
        };
      }
      throw new Error(`Unexpected native command: ${command}`);
    });

    await expect(coverCacheDiagnostics()).resolves.toEqual({
      entryCount: 2,
      totalBytes: 1_024,
      hitCount: 8,
      missCount: 1,
      staleCount: 0,
      cleanupPending: false,
    });
  });
});
