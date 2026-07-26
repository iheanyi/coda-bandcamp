import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: (value: unknown) => void;
    constructor(onmessage = () => undefined) {
      this.onmessage = onmessage;
    }
  },
  invoke: mocks.invoke,
}));

import {
  clearRuntimeCaches,
  fetchAlbum,
  fetchCoverUrl,
  fetchLibrary,
  fetchStreamUrl,
} from "./lib";

describe("runtime media caches", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-26T12:00:00Z"));
    mocks.invoke.mockReset();
    clearRuntimeCaches();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("deduplicates concurrent media URL requests", async () => {
    mocks.invoke.mockResolvedValue("https://bandcamp.com/media");

    const [first, second] = await Promise.all([
      fetchCoverUrl("cover-1"),
      fetchCoverUrl("cover-1"),
    ]);

    expect(first).toBe(second);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("refreshes cached media URLs after their bounded TTL", async () => {
    mocks.invoke
      .mockResolvedValueOnce("https://bandcamp.com/stream/first")
      .mockResolvedValueOnce("https://bandcamp.com/stream/refreshed");

    await expect(fetchStreamUrl("track-1"))
      .resolves.toBe("https://bandcamp.com/stream/first");
    vi.advanceTimersByTime(10 * 60 * 1_000 + 1);
    await expect(fetchStreamUrl("track-1"))
      .resolves.toBe("https://bandcamp.com/stream/refreshed");

    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("evicts failed requests so retries can recover", async () => {
    mocks.invoke
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce("https://bandcamp.com/cover/recovered");

    await expect(fetchCoverUrl("cover-1")).rejects.toThrow("temporary failure");
    await expect(fetchCoverUrl("cover-1"))
      .resolves.toBe("https://bandcamp.com/cover/recovered");

    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("bypasses cached album metadata for an explicit artwork refresh", async () => {
    const album = {
      id: "album-1",
      title: "Soft Focus",
      artist: "Night Archive",
      songCount: 1,
      duration: 210,
      palette: ["#111111", "#222222"] as [string, string],
    };
    mocks.invoke.mockResolvedValue([{
      id: "track-1",
      title: "Afterimage",
      artist: "Night Archive",
      album: "Soft Focus",
      albumId: "album-1",
      duration: 210,
      track: 1,
    }]);

    await fetchAlbum(album);
    await fetchAlbum(album);
    await fetchAlbum(album, { forceRefresh: true });

    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "fetch_album", {
      albumId: "album-1",
      forceRefresh: false,
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "fetch_album", {
      albumId: "album-1",
      forceRefresh: true,
    });
  });

  it("deduplicates concurrent explicit album refreshes", async () => {
    const album = {
      id: "album-1",
      title: "Soft Focus",
      artist: "Night Archive",
      songCount: 1,
      duration: 210,
      palette: ["#111111", "#222222"] as [string, string],
    };
    let resolveRefresh!: (tracks: unknown[]) => void;
    mocks.invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve;
        }),
    );

    const first = fetchAlbum(album, { forceRefresh: true });
    const second = fetchAlbum(album, { forceRefresh: true });
    resolveRefresh([{
      id: "track-1",
      title: "Afterimage",
      artist: "Night Archive",
      album: "Soft Focus",
      albumId: "album-1",
      duration: 210,
      track: 1,
    }]);

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledWith("fetch_album", {
      albumId: "album-1",
      forceRefresh: true,
    });
  });

  it("does not let an expired request failure evict its replacement", async () => {
    let rejectExpired!: (cause: Error) => void;
    mocks.invoke
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectExpired = reject;
          }),
      )
      .mockResolvedValueOnce("https://bandcamp.com/cover/replacement");

    const expired = fetchCoverUrl("cover-1");
    vi.advanceTimersByTime(60 * 60 * 1_000 + 1);
    await expect(fetchCoverUrl("cover-1"))
      .resolves.toBe("https://bandcamp.com/cover/replacement");
    rejectExpired(new Error("expired request failed"));
    await expect(expired).rejects.toThrow("expired request failed");

    await expect(fetchCoverUrl("cover-1"))
      .resolves.toBe("https://bandcamp.com/cover/replacement");
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("hydrates progressive library pages before returning the final catalog", async () => {
    mocks.invoke.mockImplementation(
      async (
        command: string,
        args?: {
          forceFull?: boolean;
          onProgress?: { onmessage: (value: unknown) => void };
        },
      ) => {
        expect(command).toBe("fetch_library");
        expect(args?.forceFull).toBe(true);
        args?.onProgress?.onmessage({
          kind: "page",
          pageIndex: 0,
          loaded: 1,
          albums: [{
            id: "album-1",
            title: "Soft Focus",
            artist: "Night Archive",
            songCount: 9,
            duration: 2_460,
          }],
        });
        return [{
          id: "album-1",
          title: "Soft Focus",
          artist: "Night Archive",
          songCount: 9,
          duration: 2_460,
        }];
      },
    );
    const onPage = vi.fn();

    const albums = await fetchLibrary(onPage, { forceFull: true });

    expect(onPage).toHaveBeenCalledWith(expect.objectContaining({
      pageIndex: 0,
      loaded: 1,
      albums: [expect.objectContaining({
        id: "album-1",
        palette: expect.any(Array),
      })],
    }));
    expect(albums).toEqual([
      expect.objectContaining({ id: "album-1", palette: expect.any(Array) }),
    ]);
  });
});
