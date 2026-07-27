import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchAlbum: vi.fn(),
  loadLibraryCache: vi.fn(),
}));

vi.mock("./lib", () => ({
  fetchAlbum: mocks.fetchAlbum,
  loadLibraryCache: mocks.loadLibraryCache,
}));

import {
  LIBRARY_AUTO_REVALIDATE_INTERVAL_MS,
  albumQueryKey,
  clearBandcampQueryData,
  ensureAlbumQueryData,
  libraryQueryKey,
  mergeLibraryProgress,
  refreshAlbumQueryData,
  shouldAutoRevalidateLibrary,
  toLibrarySummaries,
  updateLibraryData,
} from "./libraryQueries";
import type { Album, Track } from "./types";

const album = (id: string, title = id): Album => ({
  id,
  title,
  artist: "Night Archive",
  songCount: 1,
  duration: 120,
  palette: ["#777", "#222"],
});

const track = (id: string, title = id): Track => ({
  id,
  title,
  artist: "Night Archive",
  album: "Soft Focus",
  albumId: "one",
  duration: 120,
  track: 1,
  palette: ["#777", "#222"],
});

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("library query helpers", () => {
  beforeEach(() => {
    mocks.fetchAlbum.mockReset();
    mocks.loadLibraryCache.mockReset();
  });

  it("supports React-style value and functional library updates", () => {
    const client = new QueryClient();
    updateLibraryData(client, [album("one")]);
    updateLibraryData(client, (current) => [...current, album("two")]);

    expect(client.getQueryData(libraryQueryKey)).toEqual([
      expect.objectContaining({ id: "one" }),
      expect.objectContaining({ id: "two" }),
    ]);
  });

  it("keeps the library query summary-only while album queries own tracks", () => {
    const client = new QueryClient();
    const release = {
      ...album("one"),
      tracks: [track("track-1")],
    };

    updateLibraryData(client, [release]);
    client.setQueryData(albumQueryKey(release.id), release.tracks);

    expect(client.getQueryData<Album[]>(libraryQueryKey)?.[0].tracks)
      .toBeUndefined();
    expect(client.getQueryData(albumQueryKey(release.id))).toEqual(
      release.tracks,
    );
    expect(toLibrarySummaries([release])[0].tracks).toBeUndefined();
  });

  it("merges progressive pages without duplicating cached albums", () => {
    const current = [album("one", "Old"), album("two")];
    const merged = mergeLibraryProgress(current, {
      pageIndex: 0,
      loaded: 2,
      albums: [album("one", "Fresh"), album("three")],
    });

    expect(merged.map((item) => [item.id, item.title])).toEqual([
      ["one", "Fresh"],
      ["two", "two"],
      ["three", "three"],
    ]);
  });

  it("keeps a fresh populated native cache quiet", () => {
    const now = 1_800_000_000_000;
    const snapshot = {
      savedAt: now,
      lastFullSyncAt: now,
      albums: [album("one")],
    };

    expect(shouldAutoRevalidateLibrary(snapshot, now)).toBe(false);
    expect(
      shouldAutoRevalidateLibrary(
        {
          ...snapshot,
          savedAt: now - LIBRARY_AUTO_REVALIDATE_INTERVAL_MS + 1,
        },
        now,
      ),
    ).toBe(false);
  });

  it("revalidates missing, empty, stale, and future-dated native caches", () => {
    const now = 1_800_000_000_000;
    const snapshot = {
      savedAt: now,
      lastFullSyncAt: now,
      albums: [album("one")],
    };

    expect(shouldAutoRevalidateLibrary(undefined, now)).toBe(true);
    expect(
      shouldAutoRevalidateLibrary({ ...snapshot, albums: [] }, now),
    ).toBe(true);
    expect(
      shouldAutoRevalidateLibrary(
        {
          ...snapshot,
          savedAt: now - LIBRARY_AUTO_REVALIDATE_INTERVAL_MS,
        },
        now,
      ),
    ).toBe(true);
    expect(
      shouldAutoRevalidateLibrary(
        { ...snapshot, savedAt: now + 1 },
        now,
      ),
    ).toBe(true);
  });

  it("deduplicates concurrent album metadata reads through Query", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let resolveAlbum!: (tracks: Track[]) => void;
    mocks.fetchAlbum.mockReturnValueOnce(new Promise((resolve) => {
      resolveAlbum = resolve;
    }));
    const release = album("one");

    const first = ensureAlbumQueryData(client, release);
    const second = ensureAlbumQueryData(client, release);

    expect(mocks.fetchAlbum).toHaveBeenCalledTimes(1);
    resolveAlbum([track("track-1")]);
    await expect(Promise.all([first, second])).resolves.toEqual([
      [expect.objectContaining({ id: "track-1" })],
      [expect.objectContaining({ id: "track-1" })],
    ]);
  });

  it("coalesces force refreshes and replaces the album query data", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const release = album("one");
    client.setQueryData(albumQueryKey(release.id), [track("old", "Old")]);
    let resolveRefresh!: (tracks: Track[]) => void;
    mocks.fetchAlbum.mockReturnValueOnce(new Promise((resolve) => {
      resolveRefresh = resolve;
    }));

    const first = refreshAlbumQueryData(client, release);
    const second = refreshAlbumQueryData(client, release);

    await vi.waitFor(() => expect(mocks.fetchAlbum).toHaveBeenCalledTimes(1));
    expect(mocks.fetchAlbum).toHaveBeenCalledWith(release, {
      forceRefresh: true,
    });
    resolveRefresh([track("fresh", "Fresh")]);
    await expect(Promise.all([first, second])).resolves.toEqual([
      [expect.objectContaining({ id: "fresh" })],
      [expect.objectContaining({ id: "fresh" })],
    ]);
    expect(client.getQueryData(albumQueryKey(release.id))).toEqual([
      expect.objectContaining({ id: "fresh" }),
    ]);
  });

  it("does not let an older normal request swallow a force refresh", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const release = album("one");
    const normalRequest = deferred<Track[]>();
    const forcedRequest = deferred<Track[]>();
    mocks.fetchAlbum
      .mockReturnValueOnce(normalRequest.promise)
      .mockReturnValueOnce(forcedRequest.promise);

    const normal = ensureAlbumQueryData(client, release);
    const forced = refreshAlbumQueryData(client, release);

    await vi.waitFor(() => expect(mocks.fetchAlbum).toHaveBeenCalledTimes(2));
    expect(mocks.fetchAlbum).toHaveBeenNthCalledWith(1, release);
    expect(mocks.fetchAlbum).toHaveBeenNthCalledWith(2, release, {
      forceRefresh: true,
    });
    forcedRequest.resolve([track("fresh", "Fresh")]);
    await expect(forced).resolves.toEqual([
      expect.objectContaining({ id: "fresh" }),
    ]);
    normalRequest.reject(new Error("superseded"));
    await expect(normal).rejects.toThrow("superseded");
    expect(client.getQueryData(albumQueryKey(release.id))).toEqual([
      expect.objectContaining({ id: "fresh" }),
    ]);
  });

  it("retains the last good album data when a force refresh fails", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const release = album("one");
    const lastGood = [track("old", "Still playable")];
    client.setQueryData(albumQueryKey(release.id), lastGood);
    mocks.fetchAlbum.mockRejectedValueOnce(new Error("Bandcamp unavailable"));

    await expect(refreshAlbumQueryData(client, release))
      .rejects.toThrow("Bandcamp unavailable");
    expect(client.getQueryData(albumQueryKey(release.id))).toEqual(lastGood);
  });

  it("clears authenticated library and album queries on disconnect", () => {
    const client = new QueryClient();
    client.setQueryData(libraryQueryKey, [album("one")]);
    client.setQueryData(albumQueryKey("one"), [track("track-1")]);
    client.setQueryData(["bandcamp-radio-show", 979], { id: 979 });

    clearBandcampQueryData(client);

    expect(client.getQueryData(libraryQueryKey)).toBeUndefined();
    expect(client.getQueryData(albumQueryKey("one"))).toBeUndefined();
    expect(client.getQueryData(["bandcamp-radio-show", 979])).toEqual({
      id: 979,
    });
  });
});
