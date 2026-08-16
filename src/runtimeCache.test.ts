import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as codaDataModule from "./lib";
import {
  clearRuntimeCaches,
  createCodaDataBridge,
  createStreamUrlRepository,
  fetchLibrary,
  fetchStreamUrl,
  type NativeChannelFactory,
} from "./lib";

const mocks = {
  invoke: vi.fn(),
};
const createTestChannel: NativeChannelFactory = <Event>(
  onmessage: (event: Event) => void,
) => ({ onmessage });
const bridge = createCodaDataBridge(mocks.invoke, createTestChannel);
const streamUrls = createStreamUrlRepository(bridge);

type TestLibrarySyncEvent = {
  kind: "page";
  pageIndex: number;
  loaded: number;
  albums: Array<{
    id: string;
    title: string;
    artist: string;
    songCount: number;
    duration: number;
  }>;
};

type FetchLibraryInvocation = {
  forceFull?: boolean;
  onProgress?: { onmessage: (value: TestLibrarySyncEvent) => void };
};

describe("runtime stream cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-26T12:00:00Z"));
    mocks.invoke.mockReset();
    streamUrls.clear();
    clearRuntimeCaches();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps production defaults private and factory results immutable", () => {
    expect(codaDataModule).not.toHaveProperty("nativeCodaDataBridge");
    expect(Object.isFrozen(bridge)).toBe(true);
    expect(Object.isFrozen(streamUrls)).toBe(true);
  });

  it("never shares injected stream results with a native-scoped cache", async () => {
    mocks.invoke
      .mockResolvedValueOnce("https://custom.test/first")
      .mockResolvedValueOnce("https://custom.test/second");
    const nativeInvoke = vi
      .fn()
      .mockResolvedValue("https://bandcamp.com/native");
    const nativeStreamUrls = createStreamUrlRepository(
      createCodaDataBridge(nativeInvoke, createTestChannel),
    );

    await expect(fetchStreamUrl("track-1", bridge)).resolves.toBe(
      "https://custom.test/first",
    );
    await expect(fetchStreamUrl("track-1", bridge)).resolves.toBe(
      "https://custom.test/second",
    );
    await expect(nativeStreamUrls.fetch("track-1")).resolves.toBe(
      "https://bandcamp.com/native",
    );
    await expect(nativeStreamUrls.fetch("track-1")).resolves.toBe(
      "https://bandcamp.com/native",
    );

    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(nativeInvoke).toHaveBeenCalledOnce();
  });

  it("deduplicates concurrent stream URL requests", async () => {
    mocks.invoke.mockResolvedValue("https://bandcamp.com/media");

    const [first, second] = await Promise.all([
      streamUrls.fetch("track-1"),
      streamUrls.fetch("track-1"),
    ]);

    expect(first).toBe(second);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("refreshes cached media URLs after their bounded TTL", async () => {
    mocks.invoke
      .mockResolvedValueOnce("https://bandcamp.com/stream/first")
      .mockResolvedValueOnce("https://bandcamp.com/stream/refreshed");

    await expect(streamUrls.fetch("track-1")).resolves.toBe(
      "https://bandcamp.com/stream/first",
    );
    vi.advanceTimersByTime(10 * 60 * 1_000 + 1);
    await expect(streamUrls.fetch("track-1")).resolves.toBe(
      "https://bandcamp.com/stream/refreshed",
    );

    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("refreshes a stream URL immediately after playback invalidates it", async () => {
    mocks.invoke
      .mockResolvedValueOnce("https://bandcamp.com/stream/expired")
      .mockResolvedValueOnce("https://bandcamp.com/stream/refreshed");

    await expect(streamUrls.fetch("track-1")).resolves.toBe(
      "https://bandcamp.com/stream/expired",
    );
    streamUrls.invalidate("track-1");
    await expect(streamUrls.fetch("track-1")).resolves.toBe(
      "https://bandcamp.com/stream/refreshed",
    );

    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("evicts failed stream requests so retries can recover", async () => {
    mocks.invoke
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce("https://bandcamp.com/stream/recovered");

    await expect(streamUrls.fetch("track-1")).rejects.toThrow(
      "temporary failure",
    );
    await expect(streamUrls.fetch("track-1")).resolves.toBe(
      "https://bandcamp.com/stream/recovered",
    );

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

    const expired = streamUrls.fetch("track-1");
    vi.advanceTimersByTime(10 * 60 * 1_000 + 1);
    await expect(streamUrls.fetch("track-1")).resolves.toBe(
      "https://bandcamp.com/stream/replacement",
    );
    rejectExpired(new Error("expired request failed"));
    await expect(expired).rejects.toThrow("expired request failed");

    await expect(streamUrls.fetch("track-1")).resolves.toBe(
      "https://bandcamp.com/stream/replacement",
    );
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("hydrates progressive library pages before returning the final catalog", async () => {
    mocks.invoke.mockImplementation(
      async (command: string, args?: FetchLibraryInvocation) => {
        expect(command).toBe("fetch_library");
        expect(args?.forceFull).toBe(true);
        args?.onProgress?.onmessage({
          kind: "page",
          pageIndex: 0,
          loaded: 1,
          albums: [
            {
              id: "album-1",
              title: "Soft Focus",
              artist: "Night Archive",
              songCount: 9,
              duration: 2_460,
            },
          ],
        });
        return [
          {
            id: "album-1",
            title: "Soft Focus",
            artist: "Night Archive",
            songCount: 9,
            duration: 2_460,
          },
        ];
      },
    );
    const onPage = vi.fn();

    const albums = await fetchLibrary(onPage, { forceFull: true }, bridge);

    expect(onPage).toHaveBeenCalledWith(
      expect.objectContaining({
        pageIndex: 0,
        loaded: 1,
        albums: [
          expect.objectContaining({
            id: "album-1",
            palette: expect.any(Array),
          }),
        ],
      }),
    );
    expect(albums).toEqual([
      expect.objectContaining({ id: "album-1", palette: expect.any(Array) }),
    ]);
  });
});
