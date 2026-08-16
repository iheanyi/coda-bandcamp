import { beforeEach, describe, expect, it } from "vitest";
import {
  emptyLocalFavorites,
  LOCAL_FAVORITES_KEY,
  parseLocalFavoritesSerialized,
  writeLocalFavorites,
} from "./localFavorites";
import {
  readLocalFavoritesAsync,
  clearLocalFavoritesAsync,
  writeLocalFavoritesAsync,
  type LocalFavoritesStorage,
} from "./localFavoritesStore";
import { serializeLocalFavorites } from "./localFavoritesPreparation";
import type { Album, LocalFavoriteCollection, Track } from "./types";

function indexedTrack(id: string): Track {
  return {
    id,
    title: "Archive",
    artist: "Night Index",
    album: "Archive",
    albumId: "album-index",
    duration: 180,
    track: 1,
    starredAt: "2026-08-12T18:01:00Z",
    palette: ["#111", "#eee"],
  };
}

function trackIndex(id: string) {
  const track = indexedTrack(id);
  return {
    ...emptyLocalFavorites(),
    songIds: [track.id],
    tracks: [track],
  };
}

function parseStoredFavorites(serialized: string): LocalFavoriteCollection {
  const favorites = parseLocalFavoritesSerialized(serialized);
  if (!favorites) throw new Error("Expected a valid local Favorites snapshot.");
  return favorites;
}

function memoryStorage(initial?: string | null) {
  let value = initial;
  const writes: LocalFavoriteCollection[] = [];
  let clears = 0;
  const storage: LocalFavoritesStorage = {
    async read() {
      return value;
    },
    async write(serialized) {
      value = serialized;
      writes.push(parseStoredFavorites(serialized));
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
      ...trackIndex("track-legacy"),
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
      ...trackIndex("track-next"),
    };

    const pending = writeLocalFavoritesAsync(favorites, memory.storage);
    expect(memory.writes).toHaveLength(0);
    await expect(pending).resolves.toEqual(favorites);
    expect(memory.writes).toHaveLength(1);
  });

  it("returns a sanitized track-star index and drops release cache metadata", async () => {
    const memory = memoryStorage();
    const track: Track = {
      id: "track-dated",
      title: "Archive",
      artist: "Night Index",
      album: "Archive",
      albumId: "album-dated",
      duration: 180,
      track: 1,
      starredAt: "2026-08-12T18:01:00Z",
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

    expect(persisted.albumIds).toEqual([]);
    expect(persisted.albums).toEqual([]);
    expect(persisted.tracks[0].artworkUrl).toBeUndefined();
    expect(persisted.tracks[0].streamUrl).toBeUndefined();
    expect(persisted.tracks[0].starredAt).toBe(track.starredAt);
    expect(memory.writes[0]).toMatchObject({
      albumIds: [],
      albums: [],
      tracks: [{ id: track.id, starredAt: track.starredAt }],
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
      ...trackIndex("track-first"),
    }, memory.storage);
    const second = writeLocalFavoritesAsync({
      ...trackIndex("track-second"),
    }, memory.storage);

    await Promise.all([first, second]);
    expect(memory.writes.map((snapshot) => snapshot.songIds)).toEqual([
      ["track-first"],
      ["track-second"],
    ]);
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
      ...trackIndex("track-before"),
    };
    const after = {
      ...trackIndex("track-after"),
    };
    let stored: string | undefined = serializeLocalFavorites(before).serialized;
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
    let stored: string | undefined;
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
