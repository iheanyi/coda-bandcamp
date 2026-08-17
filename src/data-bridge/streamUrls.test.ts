import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearStreamUrlCache,
  createStreamUrlRepository,
} from "./streamUrls";

describe("stream URL repository", () => {
  beforeEach(() => {
    clearStreamUrlCache();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-26T12:00:00Z"));
  });

  afterEach(() => {
    clearStreamUrlCache();
    vi.useRealTimers();
  });

  it("receives only a stream fetch dependency and freezes its interface", async () => {
    const fetcher = vi.fn().mockResolvedValue("https://bandcamp.com/stream");
    const repository = createStreamUrlRepository(fetcher);

    await expect(repository.fetch("track-1")).resolves.toBe(
      "https://bandcamp.com/stream",
    );

    expect(Object.isFrozen(repository)).toBe(true);
    expect(fetcher).toHaveBeenCalledWith("track-1");
  });

  it("deduplicates requests until the media URL TTL expires", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce("https://bandcamp.com/first")
      .mockResolvedValueOnce("https://bandcamp.com/refreshed");
    const repository = createStreamUrlRepository(fetcher);

    const [first, second] = await Promise.all([
      repository.fetch("track-1"),
      repository.fetch("track-1"),
    ]);
    expect(first).toBe("https://bandcamp.com/first");
    expect(second).toBe(first);
    expect(fetcher).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(10 * 60 * 1_000 + 1);
    await expect(repository.fetch("track-1")).resolves.toBe(
      "https://bandcamp.com/refreshed",
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("evicts failed requests so retries can recover", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce("https://bandcamp.com/recovered");
    const repository = createStreamUrlRepository(fetcher);

    await expect(repository.fetch("track-1")).rejects.toThrow(
      "temporary failure",
    );
    await expect(repository.fetch("track-1")).resolves.toBe(
      "https://bandcamp.com/recovered",
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("refreshes a stream URL immediately after invalidation", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce("https://bandcamp.com/expired")
      .mockResolvedValueOnce("https://bandcamp.com/refreshed");
    const repository = createStreamUrlRepository(fetcher);

    await expect(repository.fetch("track-1")).resolves.toBe(
      "https://bandcamp.com/expired",
    );
    repository.invalidate("track-1");
    await expect(repository.fetch("track-1")).resolves.toBe(
      "https://bandcamp.com/refreshed",
    );

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not let an expired failure evict its replacement", async () => {
    let rejectExpired!: (cause: Error) => void;
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<string>((_, reject) => {
            rejectExpired = reject;
          }),
      )
      .mockResolvedValueOnce("https://bandcamp.com/replacement");
    const repository = createStreamUrlRepository(fetcher);

    const expired = repository.fetch("track-1");
    vi.advanceTimersByTime(10 * 60 * 1_000 + 1);
    await expect(repository.fetch("track-1")).resolves.toBe(
      "https://bandcamp.com/replacement",
    );
    rejectExpired(new Error("expired request failed"));
    await expect(expired).rejects.toThrow("expired request failed");

    await expect(repository.fetch("track-1")).resolves.toBe(
      "https://bandcamp.com/replacement",
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

});
