import { afterEach, describe, expect, it, vi } from "vitest";

import { awaitVirtualReturnTrigger } from "./virtualReturnEndpoint";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("awaitVirtualReturnTrigger", () => {
  it("uses a bounded number of animation frames to find the endpoint", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const findTrigger = vi.fn(() => undefined);

    const result = awaitVirtualReturnTrigger({
      findTrigger,
      isCurrent: () => true,
      scrollRoot: null,
      scrollTop: 0,
    });

    await expect(result).resolves.toBeUndefined();
    expect(findTrigger).toHaveBeenCalledTimes(9);
  });

  it("stops waiting as soon as a newer navigation generation supersedes it", async () => {
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

    await expect(result).resolves.toBeUndefined();
    expect(findTrigger).toHaveBeenCalledOnce();
  });
});
