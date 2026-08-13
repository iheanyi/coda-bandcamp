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
  fetchLibrary,
  fetchStreamUrl,
  invalidateStreamUrl,
} from "./lib";

describe("runtime stream cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-26T12:00:00Z"));
    mocks.invoke.mockReset();
    clearRuntimeCaches();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("deduplicates concurrent stream URL requests", async () => {
    mocks.invoke.mockResolvedValue("https://bandcamp.com/media");

    const [first, second] = await Promise.all([
      fetchStreamUrl("track-1"),
      fetchStreamUrl("track-1"),
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

  it("refreshes a stream URL immediately after playback invalidates it", async () => {
    mocks.invoke
      .mockResolvedValueOnce("https://bandcamp.com/stream/expired")
      .mockResolvedValueOnce("https://bandcamp.com/stream/refreshed");

    await expect(fetchStreamUrl("track-1"))
      .resolves.toBe("https://bandcamp.com/stream/expired");
    invalidateStreamUrl("track-1");
    await expect(fetchStreamUrl("track-1"))
      .resolves.toBe("https://bandcamp.com/stream/refreshed");

    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("evicts failed stream requests so retries can recover", async () => {
    mocks.invoke
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce("https://bandcamp.com/stream/recovered");

    await expect(fetchStreamUrl("track-1")).rejects.toThrow("temporary failure");
    await expect(fetchStreamUrl("track-1"))
      .resolves.toBe("https://bandcamp.com/stream/recovered");

    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("does not let an expired stream failure evict its replacement", async () => {
    let rejectExpired!: (cause: Error) => void;
    mocks.invoke
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectExpired = reject;
          }),
      )
      .mockResolvedValueOnce("https://bandcamp.com/stream/replacement");

    const expired = fetchStreamUrl("track-1");
    vi.advanceTimersByTime(10 * 60 * 1_000 + 1);
    await expect(fetchStreamUrl("track-1"))
      .resolves.toBe("https://bandcamp.com/stream/replacement");
    rejectExpired(new Error("expired request failed"));
    await expect(expired).rejects.toThrow("expired request failed");

    await expect(fetchStreamUrl("track-1"))
      .resolves.toBe("https://bandcamp.com/stream/replacement");
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
