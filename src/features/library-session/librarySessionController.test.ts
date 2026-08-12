import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { albumQueryKey, libraryQueryKey } from "@/libraryQueries";
import type { Album, Track } from "@/types";
import {
  ARTWORK_REFRESH_CONCURRENCY,
  LIBRARY_METADATA_CONCURRENCY,
  MAX_ARTWORK_DETAILS_PER_REFRESH,
  createLibrarySessionController,
  type LibrarySessionController,
} from "./librarySessionController";

function album(id: string, overrides: Partial<Album> = {}): Album {
  return {
    id,
    title: `Album ${id}`,
    artist: "Night Archive",
    songCount: 1,
    duration: 180,
    palette: ["#777", "#222"],
    ...overrides,
  };
}

function track(albumId: string, overrides: Partial<Track> = {}): Track {
  return {
    id: `track-${albumId}`,
    title: `Track ${albumId}`,
    artist: "Night Archive",
    album: `Album ${albumId}`,
    albumId,
    duration: 180,
    track: 1,
    palette: ["#777", "#222"],
    ...overrides,
  };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function queryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    checkConnection: vi.fn(async () => false),
    clearArtworkUrls: vi.fn(),
    clearRuntimeData: vi.fn(),
    disconnect: vi.fn(async () => undefined),
    emitArtworkRefresh: vi.fn(),
    ensureAlbumTracks: vi.fn(async (_client: QueryClient, release: Album) => [
      track(release.id),
    ]),
    loadCachedLibrary: vi.fn(async () => undefined),
    refreshAlbumTracks: vi.fn(async (_client: QueryClient, release: Album) => [
      track(release.id),
    ]),
    syncLibrary: vi.fn(async () => []),
    ...overrides,
  };
}

async function waitForState(
  controller: LibrarySessionController,
  predicate: (controller: LibrarySessionController) => boolean,
) {
  await vi.waitFor(() => expect(predicate(controller)).toBe(true));
}

describe("library session route access", () => {
  it("does not check the keyring or hydrate metadata before connection readiness", async () => {
    const client = queryClient();
    const release = album("one", {
      artworkUrl: "https://signed.example/album",
      tracks: [
        track("one", {
          artworkUrl: "https://signed.example/art",
          streamUrl: "https://signed.example/audio",
        }),
      ],
    });
    client.setQueryData(libraryQueryKey, [release]);
    client.setQueryData(albumQueryKey(release.id), release.tracks);
    const deps = dependencies();
    const controller = createLibrarySessionController({
      dependencies: deps,
      queryClient: client,
    });

    expect(controller.route.getSnapshot()).toEqual({
      canPreloadAuthenticatedRoute: false,
      connection: "checking",
      ready: false,
    });
    expect(controller.route.findCachedAlbum(release.id)).toEqual(
      expect.not.objectContaining({ artworkUrl: expect.anything() }),
    );
    expect(
      controller.route.findCachedAlbum(release.id)?.tracks,
    ).toBeUndefined();
    expect(controller.route.findCachedAlbumTracks(release.id)?.[0]).toEqual(
      expect.not.objectContaining({
        artworkUrl: expect.anything(),
        streamUrl: expect.anything(),
      }),
    );

    expect(controller.route.preloadAlbum(release.id)).toBeUndefined();
    expect(controller.route.preloadAlbum(release)).toBeUndefined();
    await Promise.resolve();

    expect(deps.checkConnection).not.toHaveBeenCalled();
    expect(deps.ensureAlbumTracks).not.toHaveBeenCalled();
  });

  it("starts one nonblocking Query preload after startup resolves connected", async () => {
    const client = queryClient();
    const release = album("one", {
      artworkUrl: "https://signed.example/album",
      tracks: [track("one")],
    });
    const preload = deferred<Track[]>();
    const now = Date.now();
    const deps = dependencies({
      checkConnection: vi.fn(async () => true),
      ensureAlbumTracks: vi.fn(
        async (_client: QueryClient, safeRelease: Album) => {
          expect(safeRelease.artworkUrl).toBeUndefined();
          expect(safeRelease.tracks).toBeUndefined();
          return preload.promise;
        },
      ),
      loadCachedLibrary: vi.fn(async () => ({
        albums: [release],
        lastFullSyncAt: now,
        savedAt: now,
      })),
    });
    const controller = createLibrarySessionController({
      dependencies: deps,
      queryClient: client,
    });
    controller.activate();
    await waitForState(
      controller,
      ({ getSnapshot }) => getSnapshot().sync.status === "idle",
    );

    expect(controller.route.getSnapshot()).toEqual({
      canPreloadAuthenticatedRoute: true,
      connection: "connected",
      ready: true,
    });
    expect(controller.route.preloadAlbum(release.id)).toBeUndefined();
    expect(controller.route.preloadAlbum(release)).toBeUndefined();

    await vi.waitFor(() => {
      expect(deps.ensureAlbumTracks).toHaveBeenCalledOnce();
    });
    expect(deps.checkConnection).toHaveBeenCalledOnce();

    preload.resolve([
      track("one", {
        artworkUrl: "https://signed.example/art",
        streamUrl: "https://signed.example/audio",
      }),
    ]);
    await vi.waitFor(() => {
      expect(client.getQueryData(albumQueryKey(release.id))).toBeDefined();
    });
    expect(controller.route.findCachedAlbumTracks(release.id)?.[0]).toEqual(
      expect.not.objectContaining({
        artworkUrl: expect.anything(),
        streamUrl: expect.anything(),
      }),
    );
  });
});

describe("library session startup", () => {
  it("hydrates a fresh bounded cache and leaves live sync quiet", async () => {
    const client = queryClient();
    const now = Date.now();
    const cached = album("cached", {
      artworkUrl: "https://signed.example/album",
      tracks: [track("cached")],
    });
    const deps = dependencies({
      checkConnection: vi.fn(async () => true),
      loadCachedLibrary: vi.fn(async () => ({
        albums: [cached],
        lastFullSyncAt: now,
        savedAt: now,
      })),
    });
    const controller = createLibrarySessionController({
      dependencies: deps,
      queryClient: client,
    });
    const deactivate = controller.activate();

    await waitForState(
      controller,
      ({ getSnapshot }) => getSnapshot().sync.status === "idle",
    );

    expect(controller.getSnapshot()).toEqual({
      artwork: { refreshing: false },
      connection: "connected",
      sync: { error: "", status: "idle" },
    });
    expect(Object.isFrozen(controller.getSnapshot())).toBe(true);
    expect(Object.isFrozen(controller.commands)).toBe(true);
    expect(client.getQueryData<Album[]>(libraryQueryKey)).toEqual([
      expect.not.objectContaining({
        artworkUrl: expect.anything(),
        tracks: expect.anything(),
      }),
    ]);
    expect(deps.syncLibrary).not.toHaveBeenCalled();
    deactivate();
  });

  it("surfaces a connection deadline and retries without reusing the hung check", async () => {
    const client = queryClient();
    const hangingCheck = deferred<boolean>();
    const checkConnection = vi
      .fn<() => Promise<boolean>>()
      .mockReturnValueOnce(hangingCheck.promise)
      .mockResolvedValueOnce(false);
    const deps = dependencies({ checkConnection });
    const controller = createLibrarySessionController({
      dependencies: deps,
      queryClient: client,
      startupTimeoutMs: 5,
    });
    controller.activate();

    await waitForState(
      controller,
      ({ getSnapshot }) => getSnapshot().sync.status === "error",
    );
    expect(controller.getSnapshot().sync.error).toBe(
      "Checking your saved connection took too long. Try again.",
    );
    expect(controller.route.getSnapshot().ready).toBe(false);

    await controller.commands.retryStartup();

    expect(checkConnection).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot()).toEqual({
      artwork: { refreshing: false },
      connection: "disconnected",
      sync: { error: "", status: "idle" },
    });
    expect(deps.clearRuntimeData).toHaveBeenCalledOnce();
  });

  it("streams progressive pages into Query and replaces them with the final library", async () => {
    const client = queryClient();
    const sync = deferred<Album[]>();
    let onPage:
      | ((progress: {
          albums: Album[];
          loaded: number;
          pageIndex: number;
        }) => void)
      | undefined;
    const deps = dependencies({
      checkConnection: vi.fn(async () => true),
      syncLibrary: vi.fn(
        async (
          progress: typeof onPage,
          options: Readonly<{ forceFull: boolean }>,
        ) => {
          expect(options).toEqual({ forceFull: false });
          onPage = progress;
          return sync.promise;
        },
      ),
    });
    const controller = createLibrarySessionController({
      dependencies: deps,
      queryClient: client,
    });
    controller.activate();

    await waitForState(
      controller,
      ({ getSnapshot }) => getSnapshot().sync.status === "syncing",
    );
    onPage?.({ albums: [album("page")], loaded: 1, pageIndex: 0 });

    expect(controller.getSnapshot().sync.progress).toEqual({
      loaded: 1,
      pageIndex: 0,
    });
    expect(
      client.getQueryData<Album[]>(libraryQueryKey)?.map(({ id }) => id),
    ).toEqual(["page"]);

    sync.resolve([album("final")]);
    await waitForState(
      controller,
      ({ getSnapshot }) => getSnapshot().sync.status === "idle",
    );
    expect(
      client.getQueryData<Album[]>(libraryQueryKey)?.map(({ id }) => id),
    ).toEqual(["final"]);
  });

  it("falls through a cache deadline to a non-full live sync", async () => {
    const client = queryClient();
    const hangingCache = deferred<undefined>();
    const deps = dependencies({
      checkConnection: vi.fn(async () => true),
      loadCachedLibrary: vi.fn(async () => hangingCache.promise),
      syncLibrary: vi.fn(
        async (_onPage: unknown, options: Readonly<{ forceFull: boolean }>) => {
          expect(options).toEqual({ forceFull: false });
          return [album("live")];
        },
      ),
    });
    const controller = createLibrarySessionController({
      dependencies: deps,
      queryClient: client,
      startupTimeoutMs: 5,
    });

    controller.activate();
    await waitForState(
      controller,
      ({ getSnapshot }) => getSnapshot().sync.status === "idle",
    );

    expect(deps.syncLibrary).toHaveBeenCalledOnce();
    expect(
      client.getQueryData<Album[]>(libraryQueryKey)?.map(({ id }) => id),
    ).toEqual(["live"]);
  });

  it("redacts URLs and credential values from session errors", async () => {
    const client = queryClient();
    const deps = dependencies({
      syncLibrary: vi.fn(async () => {
        throw new Error(
          "Request https://example.invalid/private?token=value failed; password=hunter2",
        );
      }),
    });
    const controller = createLibrarySessionController({
      dependencies: deps,
      queryClient: client,
    });
    controller.commands.acceptConnectedLibrary([album("one")], {
      announce: false,
    });

    await controller.commands.sync({ announce: false });

    expect(controller.getSnapshot().sync.error).toBe(
      "Request [redacted URL] failed; password=[redacted]",
    );
  });
});

describe("library session metadata orchestration", () => {
  it("bounds bulk hydration at six and batches recovered covers into Query", async () => {
    const client = queryClient();
    const releases = Array.from({ length: 8 }, (_, index) =>
      album(String(index)),
    );
    const requests = new Map(
      releases.map((release) => [release.id, deferred<Track[]>()]),
    );
    let active = 0;
    let maximumActive = 0;
    const ensureAlbumTracks = vi.fn(
      async (_client: QueryClient, release: Album) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        const tracks = await requests.get(release.id)!.promise;
        active -= 1;
        return tracks;
      },
    );
    const deps = dependencies({ ensureAlbumTracks });
    const controller = createLibrarySessionController({
      dependencies: deps,
      queryClient: client,
    });
    controller.commands.acceptConnectedLibrary(releases, { announce: false });
    const progress = vi.fn();

    const resultPromise = controller.commands.ensureAlbums(releases, {
      concurrency: 99,
      onProgress: progress,
    });

    await vi.waitFor(() => {
      expect(ensureAlbumTracks).toHaveBeenCalledTimes(
        LIBRARY_METADATA_CONCURRENCY,
      );
    });
    expect(maximumActive).toBe(LIBRARY_METADATA_CONCURRENCY);
    for (const release of releases.slice(0, LIBRARY_METADATA_CONCURRENCY)) {
      requests
        .get(release.id)!
        .resolve([track(release.id, { coverArt: `cover-${release.id}` })]);
    }
    await vi.waitFor(() => {
      expect(ensureAlbumTracks).toHaveBeenCalledTimes(releases.length);
    });
    for (const release of releases.slice(LIBRARY_METADATA_CONCURRENCY)) {
      requests
        .get(release.id)!
        .resolve([track(release.id, { coverArt: `cover-${release.id}` })]);
    }

    const result = await resultPromise;
    expect(result.stale).toBe(false);
    expect(result.failed).toBe(0);
    expect(result.albums).toHaveLength(releases.length);
    expect(progress).toHaveBeenLastCalledWith({
      completed: releases.length,
      failed: 0,
      recovered: releases.length,
      total: releases.length,
    });
    expect(
      client
        .getQueryData<Album[]>(libraryQueryKey)
        ?.every((release) => Boolean(release.coverArt)),
    ).toBe(true);
    expect(
      client
        .getQueryData<Album[]>(libraryQueryKey)
        ?.some((release) => release.tracks !== undefined),
    ).toBe(false);
  });

  it("caps artwork recovery at 200 and runs only four refreshes at once", async () => {
    const client = queryClient();
    const releases = Array.from(
      { length: MAX_ARTWORK_DETAILS_PER_REFRESH + 5 },
      (_, index) => album(String(index)),
    );
    let active = 0;
    let maximumActive = 0;
    const refreshAlbumTracks = vi.fn(
      async (_client: QueryClient, release: Album) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await Promise.resolve();
        active -= 1;
        return [track(release.id, { coverArt: `cover-${release.id}` })];
      },
    );
    const deps = dependencies({ refreshAlbumTracks });
    const notify = vi.fn();
    const controller = createLibrarySessionController({
      dependencies: deps,
      notify,
      queryClient: client,
    });
    controller.commands.acceptConnectedLibrary(releases, { announce: false });

    const first = controller.commands.refreshArtwork();
    const second = controller.commands.refreshArtwork();
    expect(first).toBe(second);
    const result = await first;

    expect(refreshAlbumTracks).toHaveBeenCalledTimes(
      MAX_ARTWORK_DETAILS_PER_REFRESH,
    );
    expect(maximumActive).toBeLessThanOrEqual(ARTWORK_REFRESH_CONCURRENCY);
    expect(result).toEqual({
      checked: MAX_ARTWORK_DETAILS_PER_REFRESH,
      recovered: MAX_ARTWORK_DETAILS_PER_REFRESH,
      stale: false,
      unchecked: 5,
    });
    expect(deps.clearArtworkUrls).toHaveBeenCalledOnce();
    expect(deps.emitArtworkRefresh).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().artwork).toEqual({ refreshing: false });
    expect(notify).toHaveBeenLastCalledWith(
      "200 missing covers recovered",
      "good",
    );
  });
});

describe("library session disconnect", () => {
  it("invalidates native, runtime, and Query state and ignores a stale sync result", async () => {
    const client = queryClient();
    const sync = deferred<Album[]>();
    const deps = dependencies({
      syncLibrary: vi.fn(async () => sync.promise),
    });
    const notify = vi.fn();
    const controller = createLibrarySessionController({
      dependencies: deps,
      notify,
      queryClient: client,
    });
    const original = album("original");
    controller.commands.acceptConnectedLibrary([original], { announce: false });
    client.setQueryData(albumQueryKey(original.id), [track(original.id)]);
    const syncing = controller.commands.sync();
    await waitForState(
      controller,
      ({ getSnapshot }) => getSnapshot().sync.status === "syncing",
    );

    await controller.commands.disconnect();
    sync.resolve([album("stale")]);
    await syncing;

    expect(deps.disconnect).toHaveBeenCalledOnce();
    expect(deps.clearRuntimeData).toHaveBeenCalledOnce();
    expect(client.getQueryData(libraryQueryKey)).toBeUndefined();
    expect(client.getQueryData(albumQueryKey(original.id))).toBeUndefined();
    expect(controller.getSnapshot()).toEqual({
      artwork: { refreshing: false },
      connection: "disconnected",
      sync: { error: "", status: "idle" },
    });
    expect(controller.route.getSnapshot()).toEqual({
      canPreloadAuthenticatedRoute: false,
      connection: "disconnected",
      ready: true,
    });
    expect(notify).toHaveBeenLastCalledWith(
      "Bandcamp credentials removed",
      "good",
    );
  });

  it("clears authenticated state and surfaces a native cleanup warning", async () => {
    const client = queryClient();
    const warning =
      "Bandcamp credentials were removed, but local metadata cleanup is still pending.";
    const deps = dependencies({
      disconnect: vi.fn(async () => warning),
    });
    const notify = vi.fn();
    const controller = createLibrarySessionController({
      dependencies: deps,
      notify,
      queryClient: client,
    });
    controller.commands.acceptConnectedLibrary([album("original")], {
      announce: false,
    });

    await controller.commands.disconnect();

    expect(controller.getSnapshot().connection).toBe("disconnected");
    expect(notify).toHaveBeenCalledWith("Bandcamp credentials removed", "good");
    expect(notify).toHaveBeenLastCalledWith(warning, "bad");
  });

  it("cancels an in-flight Query hydration so it cannot repopulate after disconnect", async () => {
    const client = queryClient();
    const metadata = deferred<Track[]>();
    const deps = dependencies({
      ensureAlbumTracks: vi.fn((queryClient: QueryClient, release: Album) =>
        queryClient.fetchQuery({
          queryKey: albumQueryKey(release.id),
          queryFn: () => metadata.promise,
        }),
      ),
    });
    const controller = createLibrarySessionController({
      dependencies: deps,
      queryClient: client,
    });
    const release = album("one");
    controller.commands.acceptConnectedLibrary([release], { announce: false });

    const hydration = controller.commands.ensureAlbum(release);
    await vi.waitFor(() => expect(client.isFetching()).toBe(1));
    await controller.commands.disconnect();
    metadata.resolve([track(release.id)]);

    await expect(hydration).resolves.toBeUndefined();
    expect(client.getQueryData(albumQueryKey(release.id))).toBeUndefined();
  });
});
