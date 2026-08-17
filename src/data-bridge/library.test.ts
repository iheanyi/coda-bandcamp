import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadLibraryCache,
  parseNativeAlbum,
  parseNativeTrack,
} from "./library";
import type { NativeValue } from "./native";

const nativeAlbum = {
  id: "album-1",
  title: "Soft Focus",
  artist: "Night Archive",
  songCount: 9,
  duration: 2_460,
};
const now = 1_800_000_000_000;
const sevenDays = 7 * 24 * 60 * 60 * 1_000;
const nativeCache = {
  version: 1,
  savedAt: now,
  lastFullSyncAt: now,
  albums: [nativeAlbum],
};

function mockNativeLibraryCache(payload: NativeValue): void {
  mockIPC((command) => {
    if (command === "load_library_cache") return payload;
    throw new Error(`Unexpected native command: ${command}`);
  });
}

afterEach(() => {
  clearMocks();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  vi.restoreAllMocks();
});

describe("library native decoders", () => {
  it("copies only bounded album fields from the native payload", () => {
    expect(parseNativeAlbum({
      ...nativeAlbum,
      artworkUrl: "https://bandcamp.com/signed-artwork",
      credentials: "must-not-cross-the-bridge",
      tracks: [{ id: "must-not-cross-the-bridge" }],
    })).toEqual(nativeAlbum);
  });

  it("ignores inherited album fields and does not invoke accessors", () => {
    let getterCalls = 0;
    const accessorAlbum = { ...nativeAlbum };
    Object.defineProperty(accessorAlbum, "id", {
      configurable: true,
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("album getter must not run");
      },
    });
    Object.defineProperty(Object.prototype, "id", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: "polluted-id",
    });
    try {
      const withoutId = {
        title: nativeAlbum.title,
        artist: nativeAlbum.artist,
        songCount: nativeAlbum.songCount,
        duration: nativeAlbum.duration,
      };
      expect(() => parseNativeAlbum(withoutId)).toThrow(
        "Invalid native response for album.id",
      );
      expect(() => parseNativeAlbum(accessorAlbum)).toThrow(
        "Invalid native response for album.id",
      );
      expect(() => parseNativeAlbum([])).toThrow(
        "Invalid native response for album",
      );
      expect(() => parseNativeAlbum(Object("boxed"))).toThrow(
        "Invalid native response for album",
      );
      expect(getterCalls).toBe(0);
    } finally {
      Reflect.deleteProperty(Object.prototype, "id");
    }
  });

  it("rejects malformed tracks with field-level native context", () => {
    expect(() => parseNativeTrack({
      id: "song-1",
      title: "Afterimage",
      artist: "Night Archive",
      album: "Soft Focus",
      albumId: "album-1",
      duration: Number.POSITIVE_INFINITY,
      track: 1,
    }, "fetch_album[0]")).toThrow(
      "Invalid native response for fetch_album[0].duration",
    );
  });

  it("loads a fresh bounded cache through the production bridge", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    mockNativeLibraryCache(nativeCache);

    await expect(loadLibraryCache()).resolves.toMatchObject({
      savedAt: now,
      lastFullSyncAt: now,
      albums: [nativeAlbum],
    });
  });

  it.each([
    [
      "stale timestamps",
      {
        ...nativeCache,
        savedAt: now - sevenDays - 1,
        lastFullSyncAt: now - sevenDays - 1,
      },
    ],
    [
      "future timestamps",
      {
        ...nativeCache,
        savedAt: now + 1,
      },
    ],
    [
      "a full-sync timestamp after the save",
      {
        ...nativeCache,
        lastFullSyncAt: now + 1,
      },
    ],
    [
      "an oversized album collection",
      {
        ...nativeCache,
        albums: Array.from({ length: 5_001 }, () => nativeAlbum),
      },
    ],
    [
      "malformed album metadata",
      {
        ...nativeCache,
        albums: [{ ...nativeAlbum, songCount: "9" }],
      },
    ],
  ])("discards %s through the production bridge", async (_label, payload) => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    mockNativeLibraryCache(payload);

    await expect(loadLibraryCache()).resolves.toBeUndefined();
  });
});
