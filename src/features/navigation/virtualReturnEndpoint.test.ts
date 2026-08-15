import { afterEach, describe, expect, it, vi } from "vitest";

import { awaitVirtualReturnTrigger } from "./virtualReturnEndpoint";

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("awaitVirtualReturnTrigger", () => {
  it("honors a one-frame snapshot budget when the endpoint stays unavailable", async () => {
    const requestAnimationFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });
    const findTrigger = vi.fn(() => undefined);

    const result = awaitVirtualReturnTrigger({
      findTrigger,
      isCurrent: () => true,
      maximumFrameWaits: 1,
      scrollRoot: null,
      scrollTop: 0,
    });

    await expect(result).resolves.toBeUndefined();
    expect(requestAnimationFrame).toHaveBeenCalledOnce();
    expect(findTrigger).toHaveBeenCalledTimes(2);
  });

  it("returns the exact endpoint when it mounts within the snapshot budget", async () => {
    const trigger = document.createElement("a");
    const scrollRoot = document.createElement("main");
    document.body.append(scrollRoot);
    let frame = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frame += 1;
      if (frame === 1) document.body.append(trigger);
      callback(0);
      return 1;
    });
    const findTrigger = vi.fn(() =>
      trigger.isConnected ? trigger : undefined,
    );

    const result = awaitVirtualReturnTrigger({
      findTrigger,
      isCurrent: () => true,
      maximumFrameWaits: 1,
      scrollRoot,
      scrollTop: 312,
    });

    await expect(result).resolves.toBe(trigger);
    expect(scrollRoot.scrollTop).toBe(312);
    expect(findTrigger).toHaveBeenCalledTimes(2);
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
