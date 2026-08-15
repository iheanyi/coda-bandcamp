import { QueryClient } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { LibrarySessionCommands } from "@/features/library-session";
import { albumQueryKey } from "@/libraryQueries";
import type { Album, Track } from "@/types";

import {
  type LibraryActionsControllerOptions,
  useLibraryActionsController,
} from "./useLibraryActionsController";

const track: Track = {
  id: "track-1",
  title: "Glass Lines",
  artist: "Signal Garden",
  album: "Blue Hours",
  albumId: "album-1",
  duration: 201,
  track: 1,
  palette: ["#777", "#222"],
};

const album: Album = {
  id: "album-1",
  title: "Blue Hours",
  artist: "Signal Garden",
  songCount: 1,
  duration: 201,
  palette: ["#777", "#222"],
};

const hydratedAlbum: Album = { ...album, tracks: [track] };

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function generationHarness() {
  let current = 1;
  return {
    advance: () => {
      current += 1;
    },
    value: {
      current: () => current,
      isCurrent: (generation: number) => generation === current,
    },
  };
}

function createSession(
  overrides: Partial<LibrarySessionCommands> = {},
): LibrarySessionCommands {
  return {
    acceptConnectedLibrary: vi.fn(),
    disconnect: vi.fn(async () => undefined),
    ensureAlbum: vi.fn(async (candidate: Album) => ({
      ...candidate,
      tracks: [track],
    })),
    ensureAlbums: vi.fn(async (candidates: readonly Album[]) => ({
      albums: candidates.map((candidate) => ({
        ...candidate,
        tracks: [track],
      })),
      failed: 0,
      stale: false,
    })),
    generation: generationHarness().value,
    refreshArtwork: vi.fn(async () => ({
      checked: 0,
      recovered: 0,
      stale: false,
      unchecked: 0,
    })),
    retryStartup: vi.fn(async () => undefined),
    sync: vi.fn(async () => undefined),
    ...overrides,
  };
}

function renderController(
  options: Readonly<{
    autoCommitNavigation?: boolean;
    queryClient?: QueryClient;
    selectedAlbumId?: string;
    session?: LibrarySessionCommands;
  }> = {},
) {
  const notify = vi.fn();
  const playback = {
    cancelShuffle: vi.fn(),
    playTrack: vi.fn(),
    playTracks: vi.fn(),
    queueTracks: vi.fn(),
    startShuffle: vi.fn(),
  };
  const detailNavigation = {
    open: vi.fn(async (request) => {
      if (options.autoCommitNavigation !== false) request.beforeCommit?.();
      return "navigated" as const;
    }),
  } satisfies LibraryActionsControllerOptions["detailNavigation"];
  const queryClient = options.queryClient ?? new QueryClient();
  let catalog = [album];
  const updateAlbums = vi.fn((update: (albums: Album[]) => Album[]) => {
    catalog = update(catalog);
  });
  const controllerOptions: LibraryActionsControllerOptions = {
    albums: catalog,
    artworkRefreshing: false,
    connected: true,
    detailNavigation,
    notify,
    playback,
    queryClient,
    selectedAlbumId: options.selectedAlbumId,
    session: options.session ?? createSession(),
    updateAlbums,
  };
  const rendered = renderHook(() =>
    useLibraryActionsController(controllerOptions),
  );
  return {
    ...rendered,
    detailNavigation,
    notify,
    playback,
    queryClient,
    updateAlbums,
  };
}

describe("useLibraryActionsController", () => {
  it("defers cold album loading state until the detail transition commits", async () => {
    const pendingAlbum = deferred<Album | undefined>();
    const session = createSession({
      ensureAlbum: vi.fn(() => pendingAlbum.promise),
    });
    const { detailNavigation, result } = renderController({
      autoCommitNavigation: false,
      session,
    });

    let openPromise!: Promise<void>;
    act(() => {
      openPromise = result.current.commands.openAlbum(album);
    });

    expect(result.current.state.loadingAlbumId).toBeUndefined();
    const request = detailNavigation.open.mock.calls[0]?.[0];
    act(() => request?.beforeCommit?.());
    expect(result.current.state.loadingAlbumId).toBe(album.id);

    await act(async () => {
      pendingAlbum.resolve(hydratedAlbum);
      await openPromise;
    });
    expect(result.current.state.loadingAlbumId).toBeUndefined();
  });

  it("does not restore cold album loading after hydration already settled", async () => {
    const pendingAlbum = deferred<Album | undefined>();
    const session = createSession({
      ensureAlbum: vi.fn(() => pendingAlbum.promise),
    });
    const { detailNavigation, result } = renderController({
      autoCommitNavigation: false,
      session,
    });

    let openPromise!: Promise<void>;
    act(() => {
      openPromise = result.current.commands.openAlbum(album);
    });
    const request = detailNavigation.open.mock.calls[0]?.[0];

    await act(async () => {
      pendingAlbum.resolve(hydratedAlbum);
      await openPromise;
    });
    expect(result.current.state.loadingAlbumId).toBeUndefined();

    act(() => request?.beforeCommit?.());
    expect(result.current.state.loadingAlbumId).toBeUndefined();
  });

  it("does not commit hydrated playback after the library generation changes", async () => {
    const pendingAlbum = deferred<Album | undefined>();
    const generation = generationHarness();
    const session = createSession({
      ensureAlbum: vi.fn(() => pendingAlbum.promise),
      generation: generation.value,
    });
    const { playback, result } = renderController({ session });

    let playPromise!: Promise<void>;
    act(() => {
      playPromise = result.current.commands.playAlbum(album);
    });
    generation.advance();
    await act(async () => {
      pendingAlbum.resolve(hydratedAlbum);
      await playPromise;
    });

    expect(playback.playTracks).not.toHaveBeenCalled();
  });

  it("reports bounded bulk progress and queues the hydrated search scope once", async () => {
    const pendingBatch = deferred<{
      albums: readonly (Album | undefined)[];
      failed: number;
      stale: boolean;
    }>();
    let reportProgress:
      | ((progress: {
          completed: number;
          failed: number;
          recovered: number;
          total: number;
        }) => void)
      | undefined;
    const session = createSession({
      ensureAlbums: vi.fn((_albums, batchOptions) => {
        reportProgress = batchOptions?.onProgress;
        return pendingBatch.promise;
      }),
    });
    const { notify, playback, result } = renderController({ session });

    let queuePromise!: Promise<void>;
    act(() => {
      queuePromise = result.current.commands.queueAlbums([album]);
    });
    expect(result.current.state.queueSearchProgress).toEqual({
      done: 0,
      total: 1,
    });

    act(() => {
      reportProgress?.({
        completed: 1,
        failed: 0,
        recovered: 1,
        total: 1,
      });
    });
    expect(result.current.state.queueSearchProgress).toEqual({
      done: 1,
      total: 1,
    });

    await act(async () => {
      pendingBatch.resolve({
        albums: [hydratedAlbum],
        failed: 0,
        stale: false,
      });
      await queuePromise;
    });

    expect(playback.queueTracks).toHaveBeenCalledOnce();
    expect(playback.queueTracks).toHaveBeenCalledWith([track]);
    expect(notify).toHaveBeenCalledWith(
      "1 track from 1 search result added",
      "good",
    );
    expect(result.current.state.queueSearchProgress).toBeUndefined();
  });

  it("does not arm loadingAlbumId when opening a visibly prefetched album", async () => {
    const queryClient = new QueryClient();
    const session = createSession({
      ensureAlbums: vi.fn(async (candidates: readonly Album[]) => {
        for (const candidate of candidates) {
          queryClient.setQueryData(albumQueryKey(candidate.id), [track]);
        }
        return {
          albums: candidates.map((candidate) => ({
            ...candidate,
            tracks: [track],
          })),
          failed: 0,
          stale: false,
        };
      }),
    });
    const { detailNavigation, result } = renderController({
      autoCommitNavigation: false,
      queryClient,
      session,
    });

    await act(async () => {
      await result.current.commands.prefetchVisibleAlbums([album]);
    });
    expect(session.ensureAlbums).toHaveBeenCalledWith([album], {
      concurrency: 6,
      mode: "preload",
    });
    expect(result.current.state.loadingAlbumId).toBeUndefined();

    let openPromise!: Promise<void>;
    act(() => {
      openPromise = result.current.commands.openAlbum(album);
    });
    const request = detailNavigation.open.mock.calls[0]?.[0];
    expect(request).toEqual(
      expect.objectContaining({ albumId: album.id, coldLoad: false }),
    );
    act(() => request?.beforeCommit?.());
    expect(result.current.state.loadingAlbumId).toBeUndefined();

    await act(async () => {
      await openPromise;
    });
    expect(result.current.state.loadingAlbumId).toBeUndefined();
  });

  it("opens cached album identity, hydrates detail, and drops its snapshot on disconnect", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(albumQueryKey(album.id), [track]);
    const session = createSession();
    const trigger = document.createElement("a");
    const { detailNavigation, playback, result } = renderController({
      queryClient,
      selectedAlbumId: album.id,
      session,
    });

    await act(async () => {
      await result.current.commands.openAlbum(album, trigger);
    });

    expect(detailNavigation.open).toHaveBeenCalledWith(
      expect.objectContaining({
        albumId: album.id,
        coldLoad: false,
        kind: "album",
        sourceTrigger: trigger,
      }),
    );
    expect(detailNavigation.open.mock.calls[0]?.[0].beforeCommit).toEqual(
      expect.any(Function),
    );
    expect(result.current.state.selectedAlbum).toEqual(hydratedAlbum);

    await act(async () => {
      await result.current.commands.disconnect();
    });

    expect(session.disconnect).toHaveBeenCalledOnce();
    expect(playback.cancelShuffle).toHaveBeenCalled();
    expect(result.current.state.selectedAlbum).toEqual(album);
  });
});
