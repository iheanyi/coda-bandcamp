import { beforeEach, describe, expect, it } from "vitest";
import {
  emptyLocalFavorites,
  LOCAL_FAVORITES_KEY,
  writeLocalFavorites,
} from "./localFavorites";
import {
  readLocalFavoritesAsync,
  clearLocalFavoritesAsync,
  writeLocalFavoritesAsync,
  type LocalFavoritesStorage,
} from "./localFavoritesStore";
import { serializeLocalFavorites } from "./localFavoritesPreparation";
import type { Album, Track } from "./types";

function memoryStorage(initial?: unknown) {
  let value = initial;
  const writes: unknown[] = [];
  let clears = 0;
  const storage: LocalFavoritesStorage = {
    async read() {
      return value;
    },
    async write(serialized) {
      value = serialized;
      writes.push(JSON.parse(serialized) as unknown);
    },
    async clear() {
      value = undefined;
      clears += 1;
    },
  };
  return {
    storage,
    get clears() {
      return clears;
    },
    get value() {
      return value;
    },
    writes,
  };
}

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("asynchronous local Favorites storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("migrates the legacy synchronous snapshot once", async () => {
    const legacy = {
      ...emptyLocalFavorites(),
      albumIds: ["album-legacy"],
    };
    writeLocalFavorites(legacy);
    const memory = memoryStorage();

    await expect(readLocalFavoritesAsync(memory.storage)).resolves.toEqual(legacy);
    expect(memory.writes).toHaveLength(1);
    expect(window.localStorage.getItem(LOCAL_FAVORITES_KEY)).toBeNull();
  });

  it("defers validation and persistence past the urgent interaction", async () => {
    const memory = memoryStorage();
    const favorites = {
      ...emptyLocalFavorites(),
      albumIds: ["album-next"],
    };

    const pending = writeLocalFavoritesAsync(favorites, memory.storage);
    expect(memory.writes).toHaveLength(0);
    await expect(pending).resolves.toEqual(favorites);
    expect(memory.writes).toHaveLength(1);
  });

  it("returns the sanitized persisted value with release metadata intact", async () => {
    const memory = memoryStorage();
    const track: Track = {
      id: "track-dated",
      title: "Archive",
      artist: "Night Index",
      album: "Archive",
      albumId: "album-dated",
      duration: 180,
      track: 1,
      artworkUrl: "https://t4.bcbits.com/signed-artwork",
      streamUrl: "https://t4.bcbits.com/signed-stream",
      palette: ["#111", "#eee"],
    };
    const album: Album = {
      id: "album-dated",
      title: "Archive",
      artist: "Night Index",
      songCount: 1,
      duration: 180,
      addedAt: "30 Jun 2025 12:00:00 GMT",
      starredAt: "2025-07-01T12:00:00Z",
      playedAt: "2025-07-02T12:00:00Z",
      originalReleaseDate: { year: 2001 },
      releaseDate: { year: 2025, month: 6, day: 30 },
      artworkUrl: "https://t4.bcbits.com/signed-artwork",
      palette: ["#111", "#eee"],
    };
    const favorites = {
      ...emptyLocalFavorites(),
      albumIds: [album.id],
      songIds: [track.id],
      albums: [album],
      tracks: [track],
    };

    const persisted = await writeLocalFavoritesAsync(favorites, memory.storage);

    expect(persisted.albums[0]).toMatchObject({
      addedAt: album.addedAt,
      starredAt: album.starredAt,
      playedAt: album.playedAt,
      originalReleaseDate: album.originalReleaseDate,
      releaseDate: album.releaseDate,
    });
    expect(persisted.albums[0].artworkUrl).toBeUndefined();
    expect(persisted.tracks[0].artworkUrl).toBeUndefined();
    expect(persisted.tracks[0].streamUrl).toBeUndefined();
    expect(memory.writes[0]).toMatchObject({
      albums: [{ releaseDate: { year: 2025, month: 6, day: 30 } }],
    });
  });

  it("rejects a failed custom persistence write instead of reporting success", async () => {
    const storage: LocalFavoritesStorage = {
      async read() {
        return undefined;
      },
      async write() {
        throw new Error("disk unavailable");
      },
      async clear() {},
    };

    await expect(writeLocalFavoritesAsync({
      ...emptyLocalFavorites(),
      albumIds: ["album-unsaved"],
    }, storage)).rejects.toThrow("disk unavailable");
  });

  it("serializes overlapping writes in user-action order", async () => {
    const memory = memoryStorage();
    const first = writeLocalFavoritesAsync({
      ...emptyLocalFavorites(),
      albumIds: ["album-first"],
    }, memory.storage);
    const second = writeLocalFavoritesAsync({
      ...emptyLocalFavorites(),
      albumIds: ["album-second"],
    }, memory.storage);

    await Promise.all([first, second]);
    expect(memory.writes.map((snapshot) => (
      snapshot as { albumIds: string[] }
    ).albumIds)).toEqual([["album-first"], ["album-second"]]);
  });

  it("clears an invalid async snapshot before migrating safe empty state", async () => {
    const memory = memoryStorage(JSON.stringify({ version: 999, albumIds: ["bad"] }));

    await expect(readLocalFavoritesAsync(memory.storage)).resolves.toEqual(
      emptyLocalFavorites(),
    );
    expect(memory.clears).toBe(1);
    expect(memory.writes).toHaveLength(1);
  });

  it("orders a refresh behind an in-flight write so stale data cannot win", async () => {
    const before = {
      ...emptyLocalFavorites(),
      albumIds: ["album-before"],
    };
    const after = {
      ...emptyLocalFavorites(),
      albumIds: ["album-after"],
    };
    let stored: unknown = serializeLocalFavorites(before).serialized;
    let reads = 0;
    const writeStarted = deferred<void>();
    const allowWrite = deferred<void>();
    const storage: LocalFavoritesStorage = {
      async read() {
        reads += 1;
        return stored;
      },
      async write(serialized) {
        writeStarted.resolve();
        await allowWrite.promise;
        stored = serialized;
      },
      async clear() {
        stored = undefined;
      },
    };

    const pendingWrite = writeLocalFavoritesAsync(after, storage);
    await writeStarted.promise;
    const pendingRefresh = readLocalFavoritesAsync(storage);
    await Promise.resolve();

    expect(reads).toBe(0);
    allowWrite.resolve();
    await expect(pendingWrite).resolves.toEqual(after);
    await expect(pendingRefresh).resolves.toEqual(after);
    expect(reads).toBe(1);
  });

  it("orders a clear behind an in-flight write so deleted state stays deleted", async () => {
    let stored: unknown;
    const events: string[] = [];
    const writeStarted = deferred<void>();
    const allowWrite = deferred<void>();
    const storage: LocalFavoritesStorage = {
      async read() {
        return stored;
      },
      async write(serialized) {
        events.push("write-started");
        writeStarted.resolve();
        await allowWrite.promise;
        stored = serialized;
        events.push("write-finished");
      },
      async clear() {
        stored = undefined;
        events.push("cleared");
      },
    };

    const pendingWrite = writeLocalFavoritesAsync({
      ...emptyLocalFavorites(),
      albumIds: ["album-pending"],
    }, storage);
    await writeStarted.promise;
    const pendingClear = clearLocalFavoritesAsync(storage);
    allowWrite.resolve();

    await pendingWrite;
    await expect(pendingClear).resolves.toEqual(emptyLocalFavorites());
    expect(events).toEqual(["write-started", "write-finished", "cleared"]);
    expect(stored).toBeUndefined();
  });
});
