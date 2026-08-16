import { act, renderHook, waitFor } from "@testing-library/react";
import {
  StrictMode,
  createElement,
  useCallback,
  useSyncExternalStore,
  type PropsWithChildren,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCoverArtSourceStore,
  type CoverArtBridge,
  type CoverArtSourceStore,
} from "./coverArtSourceStore";
import type { OwnDataValue } from "./ownData";

function createBridgeHarness(initialInvalidationSequence = 1n) {
  const handlers = new Set<(payload: OwnDataValue) => void>();
  let nextInvalidationSequence = initialInvalidationSequence;
  const bridge = {
    convertFileSource: vi.fn(
      (path: string, protocol: string) => `${protocol}:${path}`,
    ),
    invalidate: vi
      .fn<(coverArtId: string) => Promise<OwnDataValue>>()
      .mockImplementation(() => {
        const sequence = nextInvalidationSequence;
        nextInvalidationSequence += 1n;
        return Promise.resolve({ sequence: sequence.toString() });
      }),
    listenForUpdates: vi.fn((handler: (payload: OwnDataValue) => void) => {
      handlers.add(handler);
      return Promise.resolve(() => {
        handlers.delete(handler);
      });
    }),
  } satisfies CoverArtBridge;
  return {
    bridge,
    emit(payload: OwnDataValue) {
      for (const handler of handlers) handler(payload);
    },
    handlers,
  };
}

function useStoreSource(
  store: CoverArtSourceStore,
  coverArtId: string,
): string | undefined {
  const readSource = useCallback(
    () => store.source(coverArtId),
    [coverArtId, store],
  );
  return useSyncExternalStore(store.subscribe, readSource, readSource);
}

function StrictModeWrapper({ children }: PropsWithChildren) {
  return createElement(StrictMode, null, children);
}

beforeEach(() => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
  sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createCoverArtSourceStore", () => {
  it("builds validated fixed-protocol sources synchronously", async () => {
    const harness = createBridgeHarness();
    const store = createCoverArtSourceStore(harness.bridge);

    const first = store.source("ca:cover/1");
    expect(store.source("ca:cover/1")).toBe(first);
    expect(first).toMatch(
      /^coda-cover:\/v1\/600\/ca%3Acover%2F1\?v=0&s=[a-f0-9]{32}$/,
    );
    expect(first).toContain(
      `s=${sessionStorage.getItem("coda.cover-art.scope.v1")}`,
    );
    expect(harness.bridge.convertFileSource).toHaveBeenCalledWith(
      "",
      "coda-cover",
    );

    harness.bridge.convertFileSource.mockImplementationOnce(
      () => "http://coda-cover.localhost/",
    );
    expect(store.source("windows-cover")).toMatch(
      /^http:\/\/coda-cover\.localhost\/v1\/600\/windows-cover\?v=0&s=[a-f0-9]{32}$/,
    );
    harness.bridge.convertFileSource.mockImplementationOnce(
      (path: string, protocol: string) =>
        `${protocol}://localhost/${encodeURIComponent(path)}`,
    );
    expect(store.source("unix-cover")).toMatch(
      /^coda-cover:\/\/localhost\/v1\/600\/unix-cover\?v=0&s=[a-f0-9]{32}$/,
    );
    harness.bridge.convertFileSource.mockImplementationOnce(() => {
      throw new Error("Protocol conversion failed");
    });
    expect(store.source("unavailable-cover")).toBeUndefined();

    expect(store.source(" bad")).toBeUndefined();
    expect(store.source("bad\nvalue")).toBeUndefined();
    expect(store.source("ok", "../bad")).toBeUndefined();
    expect(store.source("a".repeat(513))).toBeUndefined();

    await store.dispose();
  });

  it("keeps bridge listener ownership isolated per store", async () => {
    const firstHarness = createBridgeHarness();
    const secondHarness = createBridgeHarness();
    const firstStore = createCoverArtSourceStore(firstHarness.bridge);
    const secondStore = createCoverArtSourceStore(secondHarness.bridge);
    const unsubscribeFirst = firstStore.subscribe(vi.fn());
    const unsubscribeSecond = secondStore.subscribe(vi.fn());

    expect(firstHarness.bridge.listenForUpdates).toHaveBeenCalledOnce();
    expect(secondHarness.bridge.listenForUpdates).toHaveBeenCalledOnce();

    firstHarness.emit({
      coverArtId: "shared-cover",
      revision: "first_revision",
      sequence: "1",
    });

    expect(firstStore.source("shared-cover")).toContain("?v=first_revision");
    expect(secondStore.source("shared-cover")).toContain("?v=0");

    unsubscribeFirst();
    unsubscribeSecond();
    await firstStore.dispose();
    await secondStore.dispose();
  });

  it("narrows unknown native payloads into bounded revision updates", async () => {
    const harness = createBridgeHarness();
    const store = createCoverArtSourceStore(harness.bridge);
    const subscriber = vi.fn();
    const unsubscribe = store.subscribe(subscriber);

    harness.emit(null);
    harness.emit(["bounded-cover", "array_revision"]);
    harness.emit({ coverArtId: 42, revision: "number_id" });
    harness.emit({ coverArtId: "bounded-cover", revision: 42 });
    harness.emit({
      coverArtId: "a".repeat(513),
      revision: "oversized_id",
    });
    harness.emit({
      coverArtId: "bounded-cover",
      revision: "r".repeat(129),
    });
    harness.emit({
      coverArtId: "bounded-cover",
      revision: "missing_sequence",
    });
    harness.emit({
      coverArtId: "bounded-cover",
      revision: "zero_sequence",
      sequence: "0",
    });
    harness.emit({
      coverArtId: "bounded-cover",
      revision: "leading_zero_sequence",
      sequence: "01",
    });
    harness.emit({
      coverArtId: "bounded-cover",
      revision: "overflow_sequence",
      sequence: "18446744073709551616",
    });

    expect(subscriber).not.toHaveBeenCalled();
    expect(store.source("bounded-cover")).toContain("?v=0");

    harness.emit({
      coverArtId: "bounded-cover",
      revision: "accepted_revision",
      sequence: "1",
    });
    expect(subscriber).toHaveBeenCalledOnce();
    expect(store.source("bounded-cover")).toContain("?v=accepted_revision");

    unsubscribe();
    await store.dispose();
  });

  it("persists bounded revision metadata for fresh store instances", async () => {
    const firstHarness = createBridgeHarness();
    const firstStore = createCoverArtSourceStore(firstHarness.bridge);
    const unsubscribe = firstStore.subscribe(vi.fn());
    const initialSource = firstStore.source("reloaded-cover");

    firstHarness.emit({
      coverArtId: "reloaded-cover",
      revision: "latest_2",
      sequence: "2",
    });
    firstHarness.emit({
      coverArtId: "ignored-cover",
      revision: "../invalid",
      sequence: "3",
    });
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    const stored = sessionStorage.getItem("coda.cover-art.revisions.v1");
    const persisted: unknown = JSON.parse(stored ?? "null");
    expect(persisted).toEqual([["reloaded-cover", "latest_2", "2"]]);
    expect(stored).not.toContain(initialSource);
    expect(stored).not.toContain("coda-cover");
    expect(sessionStorage.getItem("coda.cover-art.ordering-floors.v1")).toBe(
      '[["reloaded-cover","2"]]',
    );
    const scope = sessionStorage.getItem("coda.cover-art.scope.v1");

    unsubscribe();
    await firstStore.dispose();

    const reloadedHarness = createBridgeHarness();
    const reloadedStore = createCoverArtSourceStore(reloadedHarness.bridge);
    expect(reloadedStore.source("reloaded-cover")).toBe(
      `coda-cover:/v1/600/reloaded-cover?v=latest_2&s=${scope}`,
    );
    await reloadedStore.dispose();
  });

  it("rejects a delayed old event after store recreation", async () => {
    const firstHarness = createBridgeHarness();
    const firstStore = createCoverArtSourceStore(firstHarness.bridge);
    const unsubscribeFirst = firstStore.subscribe(vi.fn());
    firstHarness.emit({
      coverArtId: "recreated-cover",
      revision: "current_revision",
      sequence: "8",
    });
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    unsubscribeFirst();
    await firstStore.dispose();

    const recreatedHarness = createBridgeHarness(9n);
    const recreatedStore = createCoverArtSourceStore(recreatedHarness.bridge);
    const subscriber = vi.fn();
    const unsubscribeRecreated = recreatedStore.subscribe(subscriber);
    recreatedHarness.emit({
      coverArtId: "recreated-cover",
      revision: "delayed_old_revision",
      sequence: "7",
    });

    expect(recreatedStore.source("recreated-cover")).toContain(
      "?v=current_revision",
    );
    expect(subscriber).not.toHaveBeenCalled();

    recreatedHarness.emit({
      coverArtId: "recreated-cover",
      revision: "new_revision",
      sequence: "9",
    });
    expect(recreatedStore.source("recreated-cover")).toContain(
      "?v=new_revision",
    );
    expect(subscriber).toHaveBeenCalledOnce();

    unsubscribeRecreated();
    await recreatedStore.dispose();
  });

  it("never reuses a persisted retry revision in a fresh store", async () => {
    const firstHarness = createBridgeHarness();
    const firstStore = createCoverArtSourceStore(firstHarness.bridge);

    await firstStore.invalidate("persisted-retry-cover");
    const firstSource = firstStore.source("persisted-retry-cover");
    const firstRevision = firstSource
      ? new URL(firstSource).searchParams.get("v")
      : undefined;
    expect(firstRevision).toMatch(/^retry-\d+$/);
    await firstStore.dispose();

    const freshHarness = createBridgeHarness(2n);
    const freshStore = createCoverArtSourceStore(freshHarness.bridge);
    expect(freshStore.source("persisted-retry-cover")).toBe(firstSource);

    await freshStore.invalidate("persisted-retry-cover");
    const freshSource = freshStore.source("persisted-retry-cover");
    const freshRevision = freshSource
      ? new URL(freshSource).searchParams.get("v")
      : undefined;
    expect(freshRevision).toMatch(/^retry-\d+$/);
    expect(freshRevision).not.toBe(firstRevision);
    expect(freshSource).not.toBe(firstSource);

    await freshStore.invalidate("persisted-retry-cover");
    const repeatedSource = freshStore.source("persisted-retry-cover");
    const repeatedRevision = repeatedSource
      ? new URL(repeatedSource).searchParams.get("v")
      : undefined;
    expect(repeatedRevision).toMatch(/^retry-\d+$/);
    expect(repeatedRevision).not.toBe(firstRevision);
    expect(repeatedRevision).not.toBe(freshRevision);
    expect(repeatedSource).not.toBe(freshSource);

    await freshStore.dispose();
  });

  it("bounds restored and newly persisted revisions", async () => {
    sessionStorage.setItem(
      "coda.cover-art.revisions.v1",
      JSON.stringify(
        Array.from({ length: 5_002 }, (_, index) => [
          `cover-${index}`,
          `revision_${index}`,
        ]),
      ),
    );
    const harness = createBridgeHarness();
    const store = createCoverArtSourceStore(harness.bridge);
    const unsubscribe = store.subscribe(vi.fn());

    expect(store.source("cover-1")).toContain("?v=0");
    expect(store.source("cover-2")).toContain("?v=revision_2");
    harness.emit({
      coverArtId: "newest-cover",
      revision: "newest_revision",
      sequence: "5003",
    });
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    const persisted: unknown = JSON.parse(
      sessionStorage.getItem("coda.cover-art.revisions.v1") ?? "null",
    );
    if (!Array.isArray(persisted)) {
      throw new Error("Expected persisted cover-art revision entries.");
    }
    expect(persisted).toHaveLength(5_000);
    expect(persisted[0]).toEqual(["cover-3", "revision_3", "0"]);
    expect(persisted.at(-1)).toEqual([
      "newest-cover",
      "newest_revision",
      "5003",
    ]);

    unsubscribe();
    await store.dispose();
  });

  it("never reissues the initial cache key after persistence eviction", async () => {
    const harness = createBridgeHarness();
    const store = createCoverArtSourceStore(harness.bridge);
    const unsubscribe = store.subscribe(vi.fn());

    for (let index = 0; index < 5_000; index += 1) {
      harness.emit({
        coverArtId: `live-cover-${index}`,
        revision: `live_revision_${index}`,
        sequence: String(index + 1),
      });
    }
    harness.emit({
      coverArtId: "overflow-cover",
      revision: "overflow_revision",
      sequence: "5001",
    });
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    const oldestSource = store.source("live-cover-0");
    const oldestRevision = oldestSource
      ? new URL(oldestSource).searchParams.get("v")
      : undefined;
    expect(oldestRevision).toBe("live_revision_0");
    expect(oldestRevision).not.toBe("0");
    expect(store.source("overflow-cover")).toContain("?v=overflow_revision");

    const persisted: unknown = JSON.parse(
      sessionStorage.getItem("coda.cover-art.revisions.v1") ?? "null",
    );
    if (!Array.isArray(persisted)) {
      throw new Error("Expected persisted cover-art revision entries.");
    }
    expect(persisted).toHaveLength(5_000);
    expect(persisted[0]).toEqual(["live-cover-1", "live_revision_1", "2"]);
    expect(persisted.at(-1)).toEqual([
      "overflow-cover",
      "overflow_revision",
      "5001",
    ]);
    const persistedFloors: unknown = JSON.parse(
      sessionStorage.getItem("coda.cover-art.ordering-floors.v1") ?? "null",
    );
    if (!Array.isArray(persistedFloors)) {
      throw new Error("Expected persisted cover-art ordering floors.");
    }
    expect(persistedFloors).toHaveLength(5_000);

    unsubscribe();
    await store.dispose();
  });

  it("rejects a delayed older event after persistence eviction", async () => {
    const harness = createBridgeHarness(2n);
    const store = createCoverArtSourceStore(harness.bridge);
    const subscriber = vi.fn();
    const unsubscribe = store.subscribe(subscriber);

    harness.emit({
      coverArtId: "floor-cover",
      revision: "published_before_overflow",
      sequence: "1",
    });
    await store.invalidate("floor-cover");
    const sourceAfterInvalidation = store.source("floor-cover");
    expect(sourceAfterInvalidation).toContain("?v=retry-2");

    for (let index = 0; index < 5_000; index += 1) {
      harness.emit({
        coverArtId: `overflow-floor-${index}`,
        revision: `overflow_floor_${index}`,
        sequence: String(index + 3),
      });
    }
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    const notificationsAfterOverflow = subscriber.mock.calls.length;

    harness.emit({
      coverArtId: "floor-cover",
      revision: "stale_pre_invalidation",
      sequence: "1",
    });

    expect(store.source("floor-cover")).toBe(sourceAfterInvalidation);
    expect(subscriber).toHaveBeenCalledTimes(notificationsAfterOverflow);

    const persistedFloors: unknown = JSON.parse(
      sessionStorage.getItem("coda.cover-art.ordering-floors.v1") ?? "null",
    );
    if (!Array.isArray(persistedFloors)) {
      throw new Error("Expected persisted cover-art ordering floors.");
    }
    expect(persistedFloors).toHaveLength(5_000);
    expect(
      persistedFloors.some(
        (entry) => Array.isArray(entry) && entry[0] === "floor-cover",
      ),
    ).toBe(false);

    unsubscribe();
    await store.dispose();
  });

  it("restores only bounded revision pairs from session storage", async () => {
    sessionStorage.setItem("coda.cover-art.scope.v1", "invalid-scope");
    sessionStorage.setItem(
      "coda.cover-art.revisions.v1",
      JSON.stringify([
        null,
        {},
        ["missing-revision"],
        [42, "number_id"],
        ["number-revision", 42],
        [" bad-id", "bad_id"],
        ["bad-revision", "../bad"],
        ["restored-cover", "restored_revision"],
      ]),
    );

    const harness = createBridgeHarness();
    const store = createCoverArtSourceStore(harness.bridge);

    expect(store.source("restored-cover")).toMatch(
      /^coda-cover:\/v1\/600\/restored-cover\?v=restored_revision&s=[a-f0-9]{32}$/,
    );
    expect(store.source("number-revision")).toContain("?v=0");
    expect(sessionStorage.getItem("coda.cover-art.scope.v1")).toMatch(
      /^[a-f0-9]{32}$/,
    );

    await store.dispose();
  });

  it("keeps one active listener through Strict Mode remounts", async () => {
    const harness = createBridgeHarness();
    const store = createCoverArtSourceStore(harness.bridge);
    const source = renderHook(() => useStoreSource(store, "strict-cover"), {
      wrapper: StrictModeWrapper,
    });

    await waitFor(() => {
      expect(harness.bridge.listenForUpdates).toHaveBeenCalledOnce();
      expect(harness.handlers.size).toBe(1);
    });

    act(() => {
      harness.emit({
        coverArtId: "strict-cover",
        revision: "strict_revision",
        sequence: "1",
      });
    });
    expect(source.result.current).toContain("?v=strict_revision");

    source.unmount();
    await waitFor(() => expect(harness.handlers.size).toBe(0));
    await store.dispose();
  });

  it("rotates renderer state and re-registers a mounted listener", async () => {
    const harness = createBridgeHarness();
    const store = createCoverArtSourceStore(harness.bridge);
    const source = renderHook(() => useStoreSource(store, "mounted-cover"));
    const initialSource = source.result.current;

    act(() => {
      harness.emit({
        coverArtId: "mounted-cover",
        revision: "before_clear",
        sequence: "1",
      });
    });
    expect(source.result.current).toContain("?v=before_clear");

    act(() => store.clear());

    expect(source.result.current).toMatch(
      /^coda-cover:\/v1\/600\/mounted-cover\?v=0&s=[a-f0-9]{32}$/,
    );
    expect(source.result.current).not.toBe(initialSource);
    expect(sessionStorage.getItem("coda.cover-art.revisions.v1")).toBeNull();
    expect(sessionStorage.getItem("coda.cover-art.ordering-floors.v1")).toBe(
      '[["mounted-cover","1"]]',
    );
    await waitFor(() => {
      expect(harness.bridge.listenForUpdates).toHaveBeenCalledTimes(2);
      expect(harness.handlers.size).toBe(1);
    });
    act(() => {
      harness.emit({
        coverArtId: "mounted-cover",
        revision: "delayed_before_clear",
        sequence: "1",
      });
    });
    expect(source.result.current).toMatch(
      /^coda-cover:\/v1\/600\/mounted-cover\?v=0&s=[a-f0-9]{32}$/,
    );

    act(() => {
      harness.emit({
        coverArtId: "mounted-cover",
        revision: "after_clear",
        sequence: "2",
      });
    });
    expect(source.result.current).toContain("?v=after_clear");

    source.unmount();
    await waitFor(() => expect(harness.handlers.size).toBe(0));
    await store.dispose();
  });

  it("advances retry revisions only after successful invalidation", async () => {
    const harness = createBridgeHarness();
    const store = createCoverArtSourceStore(harness.bridge);
    const source = renderHook(() => useStoreSource(store, "broken-cover"));
    const initialSource = source.result.current;

    await act(() => store.invalidate("broken-cover"));

    expect(harness.bridge.invalidate).toHaveBeenCalledExactlyOnceWith(
      "broken-cover",
    );
    expect(source.result.current).not.toBe(initialSource);
    expect(source.result.current).toMatch(/\?v=retry-\d+&s=[a-f0-9]{32}$/);

    const successfulSource = source.result.current;
    harness.bridge.invalidate.mockRejectedValueOnce(
      new Error("Native invalidation failed"),
    );
    await expect(store.invalidate("broken-cover")).rejects.toThrow(
      "Native invalidation failed",
    );
    expect(source.result.current).toBe(successfulSource);

    source.unmount();
    await store.dispose();
  });

  it("rejects a delayed publication ordered before invalidation", async () => {
    const harness = createBridgeHarness();
    harness.bridge.invalidate.mockResolvedValueOnce({
      sequence: "2",
    });
    const store = createCoverArtSourceStore(harness.bridge);
    const unsubscribe = store.subscribe(vi.fn());

    harness.emit({
      coverArtId: "publication-race-cover",
      revision: "published_before_invalidation",
      sequence: "1",
    });
    await store.invalidate("publication-race-cover");
    const sourceAfterInvalidation = store.source("publication-race-cover");

    harness.emit({
      coverArtId: "publication-race-cover",
      revision: "published_before_invalidation",
      sequence: "1",
    });

    expect(sourceAfterInvalidation).toContain("?v=retry-2");
    expect(store.source("publication-race-cover")).toBe(
      sourceAfterInvalidation,
    );

    unsubscribe();
    await store.dispose();
  });

  it("accepts out-of-order publications for independent covers", async () => {
    const harness = createBridgeHarness();
    const store = createCoverArtSourceStore(harness.bridge);
    const subscriber = vi.fn();
    const unsubscribe = store.subscribe(subscriber);

    harness.emit({
      coverArtId: "newer-cover",
      revision: "newer_revision",
      sequence: "2",
    });
    harness.emit({
      coverArtId: "older-independent-cover",
      revision: "older_independent_revision",
      sequence: "1",
    });

    expect(store.source("newer-cover")).toContain("?v=newer_revision");
    expect(store.source("older-independent-cover")).toContain(
      "?v=older_independent_revision",
    );
    expect(subscriber).toHaveBeenCalledTimes(2);

    unsubscribe();
    await store.dispose();
  });

  it("ignores an invalidation that completes after clear", async () => {
    const harness = createBridgeHarness();
    let resolveInvalidation: (receipt: OwnDataValue) => void = () => {
      throw new Error("Invalidation was not started.");
    };
    harness.bridge.invalidate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveInvalidation = resolve;
        }),
    );
    const store = createCoverArtSourceStore(harness.bridge);
    const subscriber = vi.fn();
    const unsubscribe = store.subscribe(subscriber);
    const pendingInvalidation = store.invalidate("clear-race-cover");

    store.clear();
    const sourceAfterClear = store.source("clear-race-cover");
    const notificationsAfterClear = subscriber.mock.calls.length;
    resolveInvalidation({ sequence: "1" });
    await pendingInvalidation;
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(store.source("clear-race-cover")).toBe(sourceAfterClear);
    expect(subscriber).toHaveBeenCalledTimes(notificationsAfterClear);
    expect(sessionStorage.getItem("coda.cover-art.revisions.v1")).toBeNull();

    unsubscribe();
    await store.dispose();
  });

  it("isolates a replacement store from a disposed pending invalidation", async () => {
    const staleHarness = createBridgeHarness();
    let resolveStaleInvalidation: (receipt: OwnDataValue) => void = () => {
      throw new Error("Invalidation was not started.");
    };
    staleHarness.bridge.invalidate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStaleInvalidation = resolve;
        }),
    );
    const staleStore = createCoverArtSourceStore(staleHarness.bridge);
    const pendingInvalidation = staleStore.invalidate("replacement-cover");

    await staleStore.dispose();
    const replacementHarness = createBridgeHarness(2n);
    const replacementStore = createCoverArtSourceStore(
      replacementHarness.bridge,
    );
    await replacementStore.invalidate("replacement-cover");
    const replacementSource = replacementStore.source("replacement-cover");

    resolveStaleInvalidation({ sequence: "1" });
    await pendingInvalidation;
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(replacementStore.source("replacement-cover")).toBe(
      replacementSource,
    );
    expect(
      JSON.parse(
        sessionStorage.getItem("coda.cover-art.revisions.v1") ?? "null",
      ),
    ).toEqual([
      [
        "replacement-cover",
        replacementSource
          ? new URL(replacementSource).searchParams.get("v")
          : undefined,
        "2",
      ],
    ]);
    await replacementStore.dispose();
  });

  it("lets only the newest overlapping invalidation update a cover", async () => {
    const harness = createBridgeHarness();
    const invalidationResolvers: Array<(receipt: OwnDataValue) => void> = [];
    harness.bridge.invalidate.mockImplementation(
      () =>
        new Promise((resolve) => {
          invalidationResolvers.push(resolve);
        }),
    );
    const store = createCoverArtSourceStore(harness.bridge);
    const subscriber = vi.fn();
    const unsubscribe = store.subscribe(subscriber);

    const olderInvalidation = store.invalidate("overlapping-cover");
    const newerInvalidation = store.invalidate("overlapping-cover");
    const resolveOlder = invalidationResolvers[0];
    const resolveNewer = invalidationResolvers[1];
    if (!resolveOlder || !resolveNewer) {
      throw new Error("Expected two pending invalidations.");
    }

    resolveNewer({ sequence: "2" });
    await newerInvalidation;
    const newestSource = store.source("overlapping-cover");
    expect(newestSource).toMatch(/\?v=retry-\d+&s=[a-f0-9]{32}$/);
    expect(subscriber).toHaveBeenCalledOnce();

    resolveOlder({ sequence: "1" });
    await olderInvalidation;
    expect(store.source("overlapping-cover")).toBe(newestSource);
    expect(subscriber).toHaveBeenCalledOnce();

    unsubscribe();
    await store.dispose();
  });

  it("retains a successful ordered invalidation across a later failure", async () => {
    const harness = createBridgeHarness();
    let resolveOlderInvalidation: (receipt: OwnDataValue) => void = () => {
      throw new Error("Invalidation was not started.");
    };
    harness.bridge.invalidate
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOlderInvalidation = resolve;
          }),
      )
      .mockRejectedValueOnce(new Error("Native invalidation failed"))
      .mockResolvedValueOnce({ sequence: "2" });
    const store = createCoverArtSourceStore(harness.bridge);
    const subscriber = vi.fn();
    const unsubscribe = store.subscribe(subscriber);

    const olderInvalidation = store.invalidate("failed-retry-cover");
    await expect(store.invalidate("failed-retry-cover")).rejects.toThrow(
      "Native invalidation failed",
    );
    resolveOlderInvalidation({ sequence: "1" });
    await olderInvalidation;

    expect(store.source("failed-retry-cover")).toContain("?v=retry-1");
    expect(subscriber).toHaveBeenCalledOnce();

    await store.invalidate("failed-retry-cover");
    expect(store.source("failed-retry-cover")).toMatch(
      /\?v=retry-2&s=[a-f0-9]{32}$/,
    );
    expect(subscriber).toHaveBeenCalledTimes(2);

    unsubscribe();
    await store.dispose();
  });

  it("recovers when registration fails after all subscribers are mounted", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const harness = createBridgeHarness();
    let rejectRegistration: (reason?: Error) => void = () => {
      throw new Error("Listener registration was not started.");
    };
    harness.bridge.listenForUpdates.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectRegistration = reject;
        }),
    );
    const store = createCoverArtSourceStore(harness.bridge);
    const unsubscribeFirst = store.subscribe(vi.fn());
    const unsubscribeSecond = store.subscribe(vi.fn());

    expect(harness.bridge.listenForUpdates).toHaveBeenCalledOnce();
    rejectRegistration(new Error("Listener unavailable"));
    await Promise.resolve();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(249);
    expect(harness.bridge.listenForUpdates).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(harness.bridge.listenForUpdates).toHaveBeenCalledTimes(2);
    expect(harness.handlers.size).toBe(1);
    harness.emit({
      coverArtId: "recovered-cover",
      revision: "recovered_revision",
      sequence: "1",
    });
    expect(store.source("recovered-cover")).toContain("?v=recovered_revision");

    unsubscribeFirst();
    unsubscribeSecond();
    await store.dispose();
  });

  it("cancels listener retries on the last unsubscribe and dispose", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const harness = createBridgeHarness();
    harness.bridge.listenForUpdates.mockRejectedValue(
      new Error("Listener unavailable"),
    );
    const store = createCoverArtSourceStore(harness.bridge);
    const unsubscribe = store.subscribe(vi.fn());
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.bridge.listenForUpdates).toHaveBeenCalledOnce();
    unsubscribe();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(harness.bridge.listenForUpdates).toHaveBeenCalledOnce();

    store.subscribe(vi.fn());
    await Promise.resolve();
    await Promise.resolve();
    expect(harness.bridge.listenForUpdates).toHaveBeenCalledTimes(2);

    await store.dispose();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(harness.bridge.listenForUpdates).toHaveBeenCalledTimes(2);
  });

  it("backs off repeated registration failures to one bounded retry loop", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const harness = createBridgeHarness();
    harness.bridge.listenForUpdates.mockRejectedValue(
      new Error("Listener unavailable"),
    );
    const store = createCoverArtSourceStore(harness.bridge);
    store.subscribe(vi.fn());
    store.subscribe(vi.fn());
    store.subscribe(vi.fn());
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.bridge.listenForUpdates).toHaveBeenCalledOnce();

    const retryDelays = [250, 500, 1_000, 2_000, 4_000, 4_000];
    let expectedRegistrations = 1;
    for (const delay of retryDelays) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(harness.bridge.listenForUpdates).toHaveBeenCalledTimes(
        expectedRegistrations,
      );
      await vi.advanceTimersByTimeAsync(1);
      expectedRegistrations += 1;
      expect(harness.bridge.listenForUpdates).toHaveBeenCalledTimes(
        expectedRegistrations,
      );
    }

    await store.dispose();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(harness.bridge.listenForUpdates).toHaveBeenCalledTimes(
      expectedRegistrations,
    );
  });

  it("disposes a stale asynchronous registration before re-registering", async () => {
    const harness = createBridgeHarness();
    const staleDispose = vi.fn();
    let completeRegistration: (
      dispose: () => void | Promise<void>,
    ) => void = () => {
      throw new Error("Listener registration was not started.");
    };
    harness.bridge.listenForUpdates.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completeRegistration = resolve;
        }),
    );
    const store = createCoverArtSourceStore(harness.bridge);
    const unsubscribe = store.subscribe(vi.fn());

    unsubscribe();
    await Promise.resolve();
    completeRegistration(staleDispose);

    await waitFor(() => expect(staleDispose).toHaveBeenCalledOnce());
    const unsubscribeReplacement = store.subscribe(vi.fn());
    await waitFor(() => {
      expect(harness.bridge.listenForUpdates).toHaveBeenCalledTimes(2);
      expect(harness.handlers.size).toBe(1);
    });

    unsubscribeReplacement();
    await store.dispose();
  });

  it("ignores events from stale listener generations", async () => {
    const harness = createBridgeHarness();
    const store = createCoverArtSourceStore(harness.bridge);
    const unsubscribe = store.subscribe(vi.fn());
    await Promise.resolve();
    await Promise.resolve();
    const staleHandler = Array.from(harness.handlers)[0];
    if (!staleHandler) throw new Error("Expected an active listener.");

    store.clear();
    staleHandler({
      coverArtId: "generation-cover",
      revision: "stale_revision",
      sequence: "1",
    });

    expect(store.source("generation-cover")).toContain("?v=0");
    await waitFor(() => {
      expect(harness.bridge.listenForUpdates).toHaveBeenCalledTimes(2);
      expect(harness.handlers.size).toBe(1);
    });
    harness.emit({
      coverArtId: "generation-cover",
      revision: "current_revision",
      sequence: "2",
    });
    expect(store.source("generation-cover")).toContain("?v=current_revision");

    unsubscribe();
    await store.dispose();
  });

  it("flushes pending revisions while fully tearing down an instance", async () => {
    const harness = createBridgeHarness();
    const store = createCoverArtSourceStore(harness.bridge);
    store.subscribe(vi.fn());
    harness.emit({
      coverArtId: "teardown-cover",
      revision: "teardown_revision",
      sequence: "1",
    });
    const staleHandler = Array.from(harness.handlers)[0];
    if (!staleHandler) throw new Error("Expected an active listener.");

    await store.dispose();
    staleHandler({
      coverArtId: "teardown-cover",
      revision: "delayed_after_dispose",
      sequence: "2",
    });

    expect(harness.handlers.size).toBe(0);
    const persisted: unknown = JSON.parse(
      sessionStorage.getItem("coda.cover-art.revisions.v1") ?? "null",
    );
    expect(persisted).toEqual([["teardown-cover", "teardown_revision", "1"]]);
    expect(store.source("teardown-cover")).toBeUndefined();
  });
});
