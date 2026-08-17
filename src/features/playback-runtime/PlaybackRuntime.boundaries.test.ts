import { describe, expect, it, vi } from "vitest";

import { collectDesktopListenerCleanup } from "./adapters";
import { safePlaybackErrorDetail } from "./errors";

describe("Playback runtime boundaries", () => {
  it("cleans up a native listener when its sibling registration fails", async () => {
    const dispose = vi.fn();
    await expect(
      collectDesktopListenerCleanup([
        Promise.resolve(dispose),
        Promise.reject(new Error("system media registration failed")),
      ]),
    ).rejects.toThrow("system media registration failed");
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("bounds and redacts playback failure details", () => {
    const detail = safePlaybackErrorDetail(
      new Error(
        `GET https://user:password@example.test/audio?token=private token=second Bearer third /Users/listener/Coda/private ${"x".repeat(400)}`,
      ),
    );
    expect(detail.length).toBeLessThanOrEqual(180);
    expect(detail).toContain("[redacted URL]");
    expect(detail).toContain("token=[redacted]");
    expect(detail).toContain("[redacted authorization]");
    expect(detail).toContain("[redacted path]");
    expect(detail).not.toMatch(/password|private|second|third|listener/iu);
  });
});
