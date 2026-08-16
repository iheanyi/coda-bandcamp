import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCoverArtRendererState,
  coverArtSource,
  invalidateCoverArt,
  useCoverArtSource,
  type CoverArtBridge,
  type CoverArtWireValue,
} from "./coverArtSource";
import {
  hasPaintedCoverSource,
  rememberPaintedCoverSource,
} from "./paintedCoverSources";

const eventHandlers = new Map<number, (payload: CoverArtWireValue) => void>();
let nextEventHandlerId = 0;
const mocks = {
  convertFileSrc: vi.fn(
    (path: string, protocol: string) => `${protocol}:${path}`,
  ),
  invoke: vi
    .fn<(command: string, args: { coverArtId: string }) => Promise<void>>()
    .mockResolvedValue(undefined),
  listen: vi.fn((handler: (payload: CoverArtWireValue) => void) => {
    const handlerId = nextEventHandlerId;
    nextEventHandlerId += 1;
    eventHandlers.set(handlerId, handler);
    return Promise.resolve(() => {
      eventHandlers.delete(handlerId);
    });
  }),
};
const bridge = {
  convertFileSource: mocks.convertFileSrc,
  invalidate: async (coverArtId: string) => {
    await mocks.invoke("invalidate_cover_art", { coverArtId });
  },
  listenForUpdates: mocks.listen,
} satisfies CoverArtBridge;
const sourceFor = (coverArtId: string, revision?: string) =>
  coverArtSource(coverArtId, revision, bridge);
const useTestCoverArtSource = (coverArtId: string) =>
  useCoverArtSource(coverArtId, bridge);

beforeEach(() => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
  clearCoverArtRendererState();
  eventHandlers.clear();
  nextEventHandlerId = 0;
  mocks.convertFileSrc.mockClear();
  mocks.invoke.mockClear().mockResolvedValue(undefined);
  mocks.listen.mockClear();
});

describe("coverArtSource", () => {
  it("builds the fixed local protocol route synchronously", () => {
    const first = sourceFor("ca:cover/1");
    const second = sourceFor("ca:cover/1");
    expect(first).toBe(second);
    expect(first).toMatch(
      /^coda-cover:\/v1\/600\/ca%3Acover%2F1\?v=0&s=[a-f0-9]{32}$/,
    );
    expect(mocks.convertFileSrc).toHaveBeenCalledWith("", "coda-cover");
    expect(first).toContain(
      `s=${sessionStorage.getItem("coda.cover-art.scope.v1")}`,
    );
  });

  it("persists only safe local paint fingerprints across renderer reloads", async () => {
    const localSource = sourceFor("warm-cover");
    if (!localSource) throw new Error("Expected a local cover source.");

    rememberPaintedCoverSource(localSource);
    rememberPaintedCoverSource(
      "https://t4.bcbits.com/stream/signed-sensitive-cover.jpg",
    );
    await Promise.resolve();

    const stored = sessionStorage.getItem("coda.cover-art.painted.v1");
    expect(stored).toMatch(/^\["[a-f0-9]{8}"\]$/);
    expect(stored).not.toContain("signed-sensitive-cover");
  });

  it("uses the Windows localhost origin without encoding the logical route", () => {
    mocks.convertFileSrc.mockImplementationOnce(
      () => "http://coda-cover.localhost/",
    );
    expect(sourceFor("ca:cover/1")).toMatch(
      /^http:\/\/coda-cover\.localhost\/v1\/600\/ca%3Acover%2F1\?v=0&s=[a-f0-9]{32}$/,
    );
  });

  it("uses the macOS and Linux custom-protocol origin", () => {
    mocks.convertFileSrc.mockImplementationOnce(
      (path: string, protocol: string) =>
        `${protocol}://localhost/${encodeURIComponent(path)}`,
    );
    expect(sourceFor("ca:cover/1")).toMatch(
      /^coda-cover:\/\/localhost\/v1\/600\/ca%3Acover%2F1\?v=0&s=[a-f0-9]{32}$/,
    );
  });

  it("rejects invalid identifiers and revisions before conversion", () => {
    expect(sourceFor(" bad")).toBeUndefined();
    expect(sourceFor("bad\nvalue")).toBeUndefined();
    expect(sourceFor("ok", "../bad")).toBeUndefined();
    expect(sourceFor("a".repeat(513))).toBeUndefined();
    expect(mocks.convertFileSrc).not.toHaveBeenCalled();
  });

  it("updates only the matching cover from bounded native events", async () => {
    const coverOne = renderHook(() => useTestCoverArtSource("cover-1"));
    const coverTwo = renderHook(() => useTestCoverArtSource("cover-2"));

    expect(mocks.listen).toHaveBeenCalledTimes(1);
    act(() => {
      for (const handler of eventHandlers.values()) {
        handler({ coverArtId: "cover-1", revision: "updated_1" });
        handler({ coverArtId: "cover-2", revision: "../invalid" });
      }
    });

    expect(coverOne.result.current).toMatch(
      /^coda-cover:\/v1\/600\/cover-1\?v=updated_1&s=[a-f0-9]{32}$/,
    );
    expect(coverTwo.result.current).toMatch(
      /^coda-cover:\/v1\/600\/cover-2\?v=0&s=[a-f0-9]{32}$/,
    );
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(
      JSON.parse(
        sessionStorage.getItem("coda.cover-art.revisions.v1") ?? "null",
      ),
    ).toEqual([["cover-1", "updated_1"]]);
  });

  it("restarts a mounted listener after clear and disposes it on unmount", async () => {
    const mounted = renderHook(() => useTestCoverArtSource("cover-mounted"));
    await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalledOnce());
    expect(eventHandlers.size).toBe(1);

    act(() => clearCoverArtRendererState());
    await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalledTimes(2));
    expect(eventHandlers.size).toBe(1);
    act(() => {
      for (const handler of eventHandlers.values()) {
        handler({ coverArtId: "cover-mounted", revision: "after_clear" });
      }
    });
    expect(mounted.result.current).toContain("?v=after_clear");

    mounted.unmount();
    await vi.waitFor(() => expect(eventHandlers.size).toBe(0));
  });

  it("releases stale custom ownership before a later registration", async () => {
    const injected = renderHook(() => useTestCoverArtSource("cover-injected"));
    await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalledOnce());
    expect(eventHandlers.size).toBe(1);

    injected.unmount();
    await vi.waitFor(() => expect(eventHandlers.size).toBe(0));

    const nativeHandlers = new Set<(payload: CoverArtWireValue) => void>();
    const nativeListen = vi.fn(
      (handler: (payload: CoverArtWireValue) => void) => {
        nativeHandlers.add(handler);
        return Promise.resolve(() => {
          nativeHandlers.delete(handler);
        });
      },
    );
    const replacementNativeBridge = {
      ...bridge,
      listenForUpdates: nativeListen,
    } satisfies CoverArtBridge;
    const first = renderHook(() =>
      useCoverArtSource("cover-native", replacementNativeBridge),
    );
    const second = renderHook(() =>
      useCoverArtSource("cover-native", replacementNativeBridge),
    );
    await vi.waitFor(() => expect(nativeListen).toHaveBeenCalledOnce());

    expect(nativeListen).toHaveBeenCalledOnce();
    expect(nativeHandlers.size).toBe(1);
    act(() => {
      for (const handler of nativeHandlers) {
        handler({ coverArtId: "cover-native", revision: "native_1" });
      }
    });
    expect(first.result.current).toContain("?v=native_1");
    expect(second.result.current).toContain("?v=native_1");
  });

  it("keeps one active listener through Strict Mode remounts", async () => {
    const strict = renderHook(() => useTestCoverArtSource("cover-strict"), {
      wrapper: StrictMode,
    });

    await vi.waitFor(() => {
      expect(mocks.listen).toHaveBeenCalledOnce();
      expect(eventHandlers.size).toBe(1);
    });
    expect(eventHandlers.size).toBe(1);
    strict.unmount();
    await vi.waitFor(() => expect(eventHandlers.size).toBe(0));
  });

  it("invalidates one native entry and advances its cache-busting source", async () => {
    const source = renderHook(() => useTestCoverArtSource("broken-cover"));
    const before = source.result.current;

    await act(() => invalidateCoverArt("broken-cover", bridge));

    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "invalidate_cover_art",
      { coverArtId: "broken-cover" },
    );
    expect(source.result.current).not.toBe(before);
    expect(source.result.current).toMatch(/\?v=retry-\d+&s=[a-f0-9]{32}$/);
  });

  it("rotates the session-scoped route while clearing stored revisions", () => {
    const source = renderHook(() => useTestCoverArtSource("cover-1"));
    const initial = source.result.current;
    if (!initial) throw new Error("Expected a local cover source.");
    rememberPaintedCoverSource(initial);
    expect(hasPaintedCoverSource(initial)).toBe(true);
    act(() => {
      for (const handler of eventHandlers.values()) {
        handler({ coverArtId: "cover-1", revision: "changed" });
      }
    });
    expect(source.result.current).toContain("?v=changed");

    act(() => clearCoverArtRendererState());

    expect(source.result.current).toMatch(
      /^coda-cover:\/v1\/600\/cover-1\?v=0&s=[a-f0-9]{32}$/,
    );
    expect(source.result.current).not.toBe(initial);
    expect(hasPaintedCoverSource(initial)).toBe(false);
    expect(source.result.current).toContain(
      `s=${sessionStorage.getItem("coda.cover-art.scope.v1")}`,
    );
    expect(sessionStorage.getItem("coda.cover-art.revisions.v1")).toBeNull();
  });

  it("restores the latest native revision after a renderer module reload", async () => {
    renderHook(() => useTestCoverArtSource("cover-1"));
    act(() => {
      for (const handler of eventHandlers.values()) {
        handler({ coverArtId: "cover-1", revision: "latest_2" });
      }
    });
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    const scope = sessionStorage.getItem("coda.cover-art.scope.v1");

    vi.resetModules();
    const reloaded = await import("./coverArtSource");

    expect(reloaded.coverArtSource("cover-1", undefined, bridge)).toBe(
      `coda-cover:/v1/600/cover-1?v=latest_2&s=${scope}`,
    );
    reloaded.clearCoverArtRendererState();
  });
});
