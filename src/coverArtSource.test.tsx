import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const eventHandlers = new Set<(event: { payload: unknown }) => void>();
  return {
    convertFileSrc: vi.fn(
      (path: string, protocol: string) => `${protocol}:${path}`,
    ),
    eventHandlers,
    invoke: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    listen: vi.fn(
      (_event: string, handler: (event: { payload: unknown }) => void) => {
        eventHandlers.add(handler);
        return Promise.resolve(() => eventHandlers.delete(handler));
      },
    ),
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: mocks.convertFileSrc,
  invoke: mocks.invoke,
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));

import {
  clearCoverArtRendererState,
  coverArtSource,
  invalidateCoverArt,
  useCoverArtSource,
} from "./coverArtSource";
import {
  hasPaintedCoverSource,
  rememberPaintedCoverSource,
} from "./paintedCoverSources";

beforeEach(() => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
  clearCoverArtRendererState();
  mocks.convertFileSrc.mockClear();
  mocks.invoke.mockClear().mockResolvedValue(undefined);
});

describe("coverArtSource", () => {
  it("builds the fixed local protocol route synchronously", () => {
    const first = coverArtSource("ca:cover/1");
    const second = coverArtSource("ca:cover/1");
    expect(first).toBe(second);
    expect(first).toMatch(
      /^coda-cover:\/v1\/600\/ca%3Acover%2F1\?v=0&s=[a-f0-9]{32}$/,
    );
    expect(mocks.convertFileSrc).toHaveBeenCalledWith("", "coda-cover");
  });

  it("uses the Windows localhost origin without encoding the logical route", () => {
    mocks.convertFileSrc.mockImplementationOnce(
      () => "http://coda-cover.localhost/",
    );
    expect(coverArtSource("ca:cover/1")).toMatch(
      /^http:\/\/coda-cover\.localhost\/v1\/600\/ca%3Acover%2F1\?v=0&s=[a-f0-9]{32}$/,
    );
  });

  it("uses the macOS and Linux custom-protocol origin", () => {
    mocks.convertFileSrc.mockImplementationOnce(
      (path: string, protocol: string) =>
        `${protocol}://localhost/${encodeURIComponent(path)}`,
    );
    expect(coverArtSource("ca:cover/1")).toMatch(
      /^coda-cover:\/\/localhost\/v1\/600\/ca%3Acover%2F1\?v=0&s=[a-f0-9]{32}$/,
    );
  });

  it("rejects invalid identifiers and revisions before conversion", () => {
    expect(coverArtSource(" bad")).toBeUndefined();
    expect(coverArtSource("bad\nvalue")).toBeUndefined();
    expect(coverArtSource("ok", "../bad")).toBeUndefined();
    expect(coverArtSource("a".repeat(513))).toBeUndefined();
    expect(mocks.convertFileSrc).not.toHaveBeenCalled();
  });

  it("updates only the matching cover from bounded native events", async () => {
    const coverOne = renderHook(() => useCoverArtSource("cover-1"));
    const coverTwo = renderHook(() => useCoverArtSource("cover-2"));

    expect(mocks.listen).toHaveBeenCalledTimes(1);
    act(() => {
      for (const handler of mocks.eventHandlers) {
        handler({ payload: { coverArtId: "cover-1", revision: "updated_1" } });
        handler({ payload: { coverArtId: "cover-2", revision: "../invalid" } });
      }
    });

    expect(coverOne.result.current).toMatch(
      /^coda-cover:\/v1\/600\/cover-1\?v=updated_1&s=[a-f0-9]{32}$/,
    );
    expect(coverTwo.result.current).toMatch(
      /^coda-cover:\/v1\/600\/cover-2\?v=0&s=[a-f0-9]{32}$/,
    );
  });

  it("invalidates one native entry and advances its cache-busting source", async () => {
    const source = renderHook(() => useCoverArtSource("broken-cover"));
    const before = source.result.current;

    await act(() => invalidateCoverArt("broken-cover"));

    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "invalidate_cover_art",
      { coverArtId: "broken-cover" },
    );
    expect(source.result.current).not.toBe(before);
    expect(source.result.current).toMatch(/\?v=retry-\d+&s=[a-f0-9]{32}$/);
  });

  it("rotates the session-scoped route while clearing stored revisions", () => {
    const source = renderHook(() => useCoverArtSource("cover-1"));
    const initial = source.result.current;
    if (!initial) throw new Error("Expected a local cover source.");
    rememberPaintedCoverSource(initial);
    expect(hasPaintedCoverSource(initial)).toBe(true);
    act(() => {
      for (const handler of mocks.eventHandlers) {
        handler({ payload: { coverArtId: "cover-1", revision: "changed" } });
      }
    });
    expect(source.result.current).toContain("?v=changed");

    act(() => clearCoverArtRendererState());

    expect(source.result.current).toMatch(
      /^coda-cover:\/v1\/600\/cover-1\?v=0&s=[a-f0-9]{32}$/,
    );
    expect(source.result.current).not.toBe(initial);
    expect(hasPaintedCoverSource(initial)).toBe(false);
  });
});
