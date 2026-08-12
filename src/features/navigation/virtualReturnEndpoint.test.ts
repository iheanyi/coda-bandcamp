import { afterEach, describe, expect, it, vi } from "vitest";

import { awaitVirtualReturnTrigger } from "./virtualReturnEndpoint";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("awaitVirtualReturnTrigger", () => {
  it("remains time-bounded when animation frames stop firing", async () => {
    vi.useFakeTimers();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
    const findTrigger = vi.fn(() => undefined);

    const result = awaitVirtualReturnTrigger({
      findTrigger,
      isCurrent: () => true,
      scrollRoot: null,
      scrollTop: 0,
    });
    await vi.advanceTimersByTimeAsync(500);

    await expect(result).resolves.toBeUndefined();
    expect(findTrigger).toHaveBeenCalledTimes(9);
  });

  it("stops waiting as soon as a newer navigation generation supersedes it", async () => {
    vi.useFakeTimers();
    let current = true;
    const findTrigger = vi.fn(() => {
      current = false;
      return undefined;
    });

    const result = awaitVirtualReturnTrigger({
      findTrigger,
      isCurrent: () => current,
      scrollRoot: null,
      scrollTop: 0,
    });
    await vi.advanceTimersByTimeAsync(50);

    await expect(result).resolves.toBeUndefined();
    expect(findTrigger).toHaveBeenCalledOnce();
  });
});
