import { clearMocks, mockConvertFileSrc, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCoverArtRendererState,
  coverArtSource,
  invalidateCoverArt,
} from "./coverArtSource";
import {
  hasPaintedCoverSource,
  rememberPaintedCoverSource,
} from "./paintedCoverSources";

beforeEach(() => {
  clearMocks();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  sessionStorage.clear();
  clearCoverArtRendererState();
});

afterEach(() => {
  clearMocks();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});

describe("cover art renderer state", () => {
  it("persists only safe local paint fingerprints", async () => {
    rememberPaintedCoverSource(
      "coda-cover:/v1/600/warm-cover?v=0&s=0123456789abcdef0123456789abcdef",
    );
    rememberPaintedCoverSource(
      "https://t4.bcbits.com/stream/signed-sensitive-cover.jpg",
    );
    await Promise.resolve();

    const stored = sessionStorage.getItem("coda.cover-art.painted.v1");
    expect(stored).toMatch(/^\["[a-f0-9]{8}"\]$/);
    expect(stored).not.toContain("signed-sensitive-cover");
  });

  it("clears painted state and announces a renderer refresh", () => {
    const source =
      "coda-cover:/v1/600/clear-cover?v=0&s=0123456789abcdef0123456789abcdef";
    const refresh = vi.fn();
    rememberPaintedCoverSource(source);
    window.addEventListener("coda:refresh-artwork", refresh);

    clearCoverArtRendererState();

    expect(hasPaintedCoverSource(source)).toBe(false);
    expect(refresh).toHaveBeenCalledOnce();
    window.removeEventListener("coda:refresh-artwork", refresh);
  });

  it("rejects a malformed invalidation receipt without advancing artwork", async () => {
    mockConvertFileSrc("macos");
    const before = coverArtSource("malformed-invalidation-cover");

    for (const malformed of [
      { unexpected: "payload" },
      { sequence: 1 },
      { sequence: "0" },
      { sequence: "01" },
      { sequence: "18446744073709551616" },
    ]) {
      mockIPC((command) => {
        if (command === "invalidate_cover_art") return malformed;
        throw new Error(`Unexpected native command: ${command}`);
      });
      await expect(
        invalidateCoverArt("malformed-invalidation-cover"),
      ).rejects.toThrow("Invalid native response for invalidate_cover_art");
      expect(coverArtSource("malformed-invalidation-cover")).toBe(before);
    }

    mockIPC((command) => {
      if (command === "invalidate_cover_art") return { sequence: "1" };
      throw new Error(`Unexpected native command: ${command}`);
    });
    await invalidateCoverArt("malformed-invalidation-cover");
    expect(coverArtSource("malformed-invalidation-cover")).not.toBe(before);
  });
});
