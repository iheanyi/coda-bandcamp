import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { emptyLocalFavorites } from "@/localFavorites";
import type {
  Album,
  LocalFavoriteCollection,
  Track,
} from "@/types";
import {
  type LocalFavoritesRepository,
  useLocalFavoritesController,
} from "./useLocalFavoritesController";

const track: Track = {
  id: "track-1",
  title: "Glass Lines",
  artist: "Signal Garden",
  album: "Blue Hours",
  albumId: "album-1",
  duration: 201,
  track: 1,
  palette: ["#777", "#222"],
};

const album: Album = {
  id: "album-1",
  title: "Blue Hours",
  artist: "Signal Garden",
  songCount: 1,
  duration: 201,
  tracks: [track],
  palette: ["#777", "#222"],
};

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function renderController(
  repository: LocalFavoritesRepository,
  notify = vi.fn(),
) {
  const rendered = renderHook(() => useLocalFavoritesController({
    albums: [album],
    notify,
    queue: [track],
    repository,
    selectedAlbum: album,
  }));
  return { ...rendered, notify };
}

describe("useLocalFavoritesController", () => {
  it("finishes readiness with a retryable error when the initial read fails", async () => {
    const repository: LocalFavoritesRepository = {
      read: vi.fn().mockRejectedValue(new Error("Local Favorites are unavailable")),
      write: vi.fn(),
    };
    const { result, notify } = renderController(repository);

    await waitFor(() => expect(result.current.ready).toBe(true));

    expect(result.current.collection).toEqual(emptyLocalFavorites());
    expect(result.current.loadError).toBe("Local Favorites are unavailable");
    expect(notify).toHaveBeenCalledWith(
      "Local Favorites are unavailable",
      "bad",
    );
  });

  it("ignores a stale refresh result", async () => {
    const first = deferred<LocalFavoriteCollection>();
    const second = deferred<LocalFavoriteCollection>();
    const repository: LocalFavoritesRepository = {
      read: vi.fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise),
      write: vi.fn(),
    };
    const { result } = renderController(repository);

    act(() => result.current.refresh());
    await act(async () => {
      second.resolve({
        ...emptyLocalFavorites(),
        albumIds: [album.id],
        albums: [album],
      });
      await second.promise;
    });
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      first.resolve(emptyLocalFavorites());
      await first.promise;
    });
    expect(result.current.collection.albumIds).toEqual([album.id]);
  });

  it("rolls back the latest optimistic favorite and withholds success on write failure", async () => {
    const repository: LocalFavoritesRepository = {
      read: vi.fn().mockResolvedValue(emptyLocalFavorites()),
      write: vi.fn().mockRejectedValue(new Error("Favorites storage is full")),
    };
    const { result, notify } = renderController(repository);
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => result.current.toggleFavorite(album.id, "album"));
    expect(result.current.favoriteAlbumIds.has(album.id)).toBe(true);

    await waitFor(() => {
      expect(result.current.favoriteAlbumIds.has(album.id)).toBe(false);
    });
    expect(notify).toHaveBeenCalledWith("Favorites storage is full", "bad");
    expect(notify).not.toHaveBeenCalledWith(
      "Saved to Favorites on this device",
      "good",
    );
  });

  it("uses the sanitized persisted value and announces only after success", async () => {
    const write = deferred<LocalFavoriteCollection>();
    const repository: LocalFavoritesRepository = {
      read: vi.fn().mockResolvedValue(emptyLocalFavorites()),
      write: vi.fn().mockReturnValue(write.promise),
    };
    const { result, notify } = renderController(repository);
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => result.current.toggleFavorite(album.id, "album"));
    expect(result.current.favoriteAlbumIds.has(album.id)).toBe(true);
    expect(notify).not.toHaveBeenCalledWith(
      "Saved to Favorites on this device",
      "good",
    );

    const sanitized = {
      ...emptyLocalFavorites(),
      albumIds: [album.id],
      albums: [{ ...album, tracks: undefined }],
    };
    await act(async () => {
      write.resolve(sanitized);
      await write.promise;
    });

    expect(result.current.collection).toEqual(sanitized);
    expect(notify).toHaveBeenCalledWith(
      "Saved to Favorites on this device",
      "good",
    );
  });
});
