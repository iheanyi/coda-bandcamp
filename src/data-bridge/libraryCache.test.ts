import { describe, expect, it } from "vitest";
import {
  parseNativeLibraryCachePayload,
  parseStoredLibraryCachePayload,
} from "./libraryCache";

const now = 1_800_000_000_000;
const nativeAlbum = {
  id: "album-1",
  title: "Soft Focus",
  artist: "Night Archive",
  songCount: 9,
  duration: 2_460,
  coverArt: "cover-1",
  addedAt: "30 Jun 2026 12:00:00 GMT",
};
const nativeCache = {
  version: 1,
  savedAt: now,
  lastFullSyncAt: now,
  albums: [nativeAlbum],
};
const storedCache = {
  version: 1,
  savedAt: now,
  lastFullSyncAt: now,
  albums: [{
    ...nativeAlbum,
    palette: ["#cf6046", "#2f2624"],
  }],
};

describe("library cache payload validation", () => {
  it.each([undefined, 0, 2, "1"])(
    "rejects unsupported snapshot version %j",
    (version) => {
      expect(parseNativeLibraryCachePayload({
        ...nativeCache,
        version,
      }, now)).toBeUndefined();
      expect(parseStoredLibraryCachePayload({
        ...storedCache,
        version,
      }, now)).toBeUndefined();
    },
  );

  it("returns named native metadata without runtime media fields", () => {
    const parsed = parseNativeLibraryCachePayload({
      ...nativeCache,
      albums: [{
        ...nativeAlbum,
        artworkUrl: "https://bandcamp.com/signed-cover",
        streamUrl: "https://bandcamp.com/signed-stream",
        tracks: [{ streamUrl: "https://bandcamp.com/signed-track" }],
      }],
    }, now);

    expect(parsed).toEqual(nativeCache);
    expect(parsed?.albums[0]).not.toHaveProperty("artworkUrl");
    expect(parsed?.albums[0]).not.toHaveProperty("streamUrl");
    expect(parsed?.albums[0]).not.toHaveProperty("tracks");
  });

  it("rejects null, inherited, accessor, and coercion-spoofed payloads", () => {
    const inherited = Object.create(nativeCache);
    let savedAtReads = 0;
    const accessorPayload = {
      ...nativeCache,
      get savedAt() {
        savedAtReads += 1;
        return now;
      },
    };
    let coercions = 0;
    const spoofedId = {
      [Symbol.toPrimitive]() {
        coercions += 1;
        return nativeAlbum.id;
      },
    };

    expect(parseNativeLibraryCachePayload(null, now)).toBeUndefined();
    expect(parseNativeLibraryCachePayload(inherited, now)).toBeUndefined();
    expect(parseNativeLibraryCachePayload(accessorPayload, now)).toBeUndefined();
    expect(savedAtReads).toBe(0);
    expect(parseNativeLibraryCachePayload({
      ...nativeCache,
      albums: [{ ...nativeAlbum, id: spoofedId }],
    }, now)).toBeUndefined();
    expect(coercions).toBe(0);
  });

  it("ignores Object.prototype fields and does not invoke album accessors", () => {
    let getterCalls = 0;
    const accessorAlbum = { ...nativeAlbum };
    Object.defineProperty(accessorAlbum, "title", {
      configurable: true,
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("cached album getter must not run");
      },
    });
    Object.defineProperty(Object.prototype, "id", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: "polluted-id",
    });
    try {
      expect(parseNativeLibraryCachePayload({
        ...nativeCache,
        albums: [{
          title: nativeAlbum.title,
          artist: nativeAlbum.artist,
          songCount: nativeAlbum.songCount,
          duration: nativeAlbum.duration,
        }],
      }, now)).toBeUndefined();
      expect(parseNativeLibraryCachePayload({
        ...nativeCache,
        albums: [accessorAlbum],
      }, now)).toBeUndefined();
      expect(parseStoredLibraryCachePayload({
        ...storedCache,
        albums: [[]],
      }, now)).toBeUndefined();
      expect(getterCalls).toBe(0);
    } finally {
      Reflect.deleteProperty(Object.prototype, "id");
    }
  });

  it("enforces seven-day timestamps and the 5,000-album bound", () => {
    const sevenDays = 7 * 24 * 60 * 60 * 1_000;

    expect(parseNativeLibraryCachePayload({
      ...nativeCache,
      savedAt: now - sevenDays,
      lastFullSyncAt: now - sevenDays,
    }, now)).toBeDefined();
    expect(parseStoredLibraryCachePayload({
      ...storedCache,
      savedAt: now - sevenDays,
      lastFullSyncAt: now - sevenDays,
    }, now)).toBeDefined();
    expect(parseNativeLibraryCachePayload({
      ...nativeCache,
      savedAt: now - sevenDays - 1,
      lastFullSyncAt: now - sevenDays - 1,
    }, now)).toBeUndefined();
    expect(parseStoredLibraryCachePayload({
      ...storedCache,
      savedAt: now - sevenDays - 1,
      lastFullSyncAt: now - sevenDays - 1,
    }, now)).toBeUndefined();
    expect(parseNativeLibraryCachePayload({
      ...nativeCache,
      savedAt: now + 1,
    }, now)).toBeUndefined();
    expect(parseStoredLibraryCachePayload({
      ...storedCache,
      savedAt: now + 1,
    }, now)).toBeUndefined();
    expect(parseNativeLibraryCachePayload({
      ...nativeCache,
      lastFullSyncAt: now + 1,
    }, now)).toBeUndefined();
    expect(parseStoredLibraryCachePayload({
      ...storedCache,
      lastFullSyncAt: now + 1,
    }, now)).toBeUndefined();
    expect(parseNativeLibraryCachePayload({
      ...nativeCache,
      albums: Array.from({ length: 5_001 }, () => nativeAlbum),
    }, now)).toBeUndefined();
    expect(parseStoredLibraryCachePayload({
      ...storedCache,
      albums: Array.from(
        { length: 5_001 },
        () => storedCache.albums[0],
      ),
    }, now)).toBeUndefined();
  });

  it("accepts albums whose optional metadata fields are absent", () => {
    const requiredMetadata = {
      id: nativeAlbum.id,
      title: nativeAlbum.title,
      artist: nativeAlbum.artist,
      songCount: nativeAlbum.songCount,
      duration: nativeAlbum.duration,
    };

    expect(parseNativeLibraryCachePayload({
      ...nativeCache,
      albums: [requiredMetadata],
    }, now)?.albums).toEqual([requiredMetadata]);
    expect(parseStoredLibraryCachePayload({
      ...storedCache,
      albums: [{
        ...requiredMetadata,
        palette: storedCache.albums[0].palette,
      }],
    }, now)).toEqual([{
      ...requiredMetadata,
      palette: storedCache.albums[0].palette,
    }]);

    const nullableNativeOptionals = {
      ...requiredMetadata,
      coverArt: null,
      year: null,
      genre: null,
      addedAt: null,
      starredAt: null,
      playedAt: null,
      originalReleaseDate: null,
      releaseDate: null,
    };
    expect(parseNativeLibraryCachePayload({
      ...nativeCache,
      albums: [nullableNativeOptionals],
    }, now)?.albums).toEqual([requiredMetadata]);
  });

  it("rejects malformed required metadata", () => {
    expect(parseNativeLibraryCachePayload({
      ...nativeCache,
      albums: [{ ...nativeAlbum, songCount: -1 }],
    }, now)).toBeUndefined();
    expect(parseStoredLibraryCachePayload({
      ...storedCache,
      albums: [{ ...storedCache.albums[0], songCount: -1 }],
    }, now)).toBeUndefined();
    expect(parseStoredLibraryCachePayload({
      ...storedCache,
      albums: [{ ...storedCache.albums[0], palette: ["#cf6046"] }],
    }, now)).toBeUndefined();
  });

  it.each([
    ["cover art", { coverArt: 42 }],
    ["year", { year: 0 }],
    ["genre", { genre: { name: "Ambient" } }],
    ["added timestamp", { addedAt: "not-a-date" }],
    ["starred timestamp", { starredAt: ["2026-07-01"] }],
    ["played timestamp", { playedAt: Number.POSITIVE_INFINITY }],
    ["original release date", { originalReleaseDate: {} }],
    ["release date", { releaseDate: { year: 2025, month: 2, day: 29 } }],
  ])("rejects malformed optional %s metadata", (_label, malformedMetadata) => {
    expect(parseNativeLibraryCachePayload({
      ...nativeCache,
      albums: [{ ...nativeAlbum, ...malformedMetadata }],
    }, now)).toBeUndefined();
    expect(parseStoredLibraryCachePayload({
      ...storedCache,
      albums: [{
        ...storedCache.albums[0],
        ...malformedMetadata,
      }],
    }, now)).toBeUndefined();
  });
});
