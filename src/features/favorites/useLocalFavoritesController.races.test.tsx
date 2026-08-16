import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { emptyLocalFavorites, MAX_FAVORITE_TRACKS } from "@/localFavorites";
import type {
  Album,
  FavoriteCollection,
  FavoriteInput,
  FavoriteMutationResult,
  FavoriteTrackReconciliation,
  Track,
} from "@/types";
import {
  FAVORITES_QUERY_KEY,
  type LocalFavoritesRepository,
  type MusicFavoritesRepository,
  useLocalFavoritesController,
} from "./useLocalFavoritesController";

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

const secondTrack: Track = {
  ...track,
  id: "track-2",
  title: "Afterimage",
  track: 2,
};

const album: Album = {
  id: "album-1",
  title: "Blue Hours",
  artist: "Signal Garden",
  songCount: 2,
  duration: 402,
  tracks: [track, secondTrack],
  palette: ["#777", "#222"],
};

const radioShow = {
  id: 42,
  subtitle: "The Hip Hop Show",
  description: "New favorites from around the world.",
  publishedAt: "2026-08-10T12:00:00Z",
};

function songMutation(source: Track, favorite: boolean): FavoriteMutationResult {
  const favoriteTrack: Track = { ...source };
  if (favorite) favoriteTrack.starredAt = "2026-08-12T18:01:00Z";
  return {
    accepted: true,
    verification: "verified",
    favorite,
    track: favoriteTrack,
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

function renderController(
  repository: LocalFavoritesRepository,
  notify = vi.fn(),
  options: Readonly<{
    albums?: readonly Album[];
    connected?: boolean;
    musicRepository?: MusicFavoritesRepository;
    queue?: readonly Track[];
    selectedAlbum?: Album;
  }> = {},
) {
  const musicRepository = options.musicRepository ?? {
    read: vi.fn().mockResolvedValue({
      albumIds: [],
      songIds: [],
      albums: [],
      tracks: [],
    }),
    write: vi.fn().mockImplementation(async (input: FavoriteInput) => {
      const source = input.id === secondTrack.id ? secondTrack : track;
      return songMutation(source, input.favorite);
    }),
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const rendered = renderHook(() => useLocalFavoritesController({
    albums: options.albums ?? [album],
    connected: options.connected ?? true,
    musicRepository,
    notify,
    queue: options.queue ?? [track, secondTrack],
    repository,
    selectedAlbum: options.selectedAlbum ?? album,
  }), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
  return { ...rendered, notify, queryClient };
}

function echoingRepository(
  initial = emptyLocalFavorites(),
): LocalFavoritesRepository {
  return {
    read: vi.fn().mockResolvedValue(initial),
    write: vi.fn().mockImplementation(async (favorites) => favorites),
  };
}

describe("useLocalFavoritesController races", () => {
  it("keeps a later pending track star when an earlier star confirms", async () => {
    const firstWrite = deferred<FavoriteMutationResult>();
    const secondWrite = deferred<FavoriteMutationResult>();
    const repository = echoingRepository();
    const musicRepository = {
      read: vi.fn().mockResolvedValue({
        albumIds: [],
        songIds: [],
        albums: [],
        tracks: [],
      }),
      write: vi.fn().mockImplementation((input: FavoriteInput) =>
        input.id === track.id ? firstWrite.promise : secondWrite.promise),
    };
    const { result } = renderController(repository, vi.fn(), { musicRepository });
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => {
      result.current.toggleFavorite(track.id, "song", true);
      result.current.toggleFavorite(secondTrack.id, "song", true);
    });
    await waitFor(() => {
      expect(result.current.favoriteTrackIds.has(track.id)).toBe(true);
      expect(result.current.favoriteTrackIds.has(secondTrack.id)).toBe(true);
    });

    act(() => firstWrite.resolve(songMutation(track, true)));
    await waitFor(() => {
      expect(result.current.favoriteTrackIds.has(track.id)).toBe(true);
      expect(result.current.favoriteTrackIds.has(secondTrack.id)).toBe(true);
    });
    expect(repository.write).toHaveBeenCalledWith(expect.objectContaining({
      songIds: expect.arrayContaining([track.id, secondTrack.id]),
    }));

    act(() => secondWrite.resolve(songMutation(secondTrack, true)));
    await waitFor(() => {
      expect(result.current.favoriteTrackIds.has(track.id)).toBe(true);
      expect(result.current.favoriteTrackIds.has(secondTrack.id)).toBe(true);
    });
  });

  it("keeps a later pending track star when an earlier star is rejected", async () => {
    const firstWrite = deferred<FavoriteMutationResult>();
    const secondWrite = deferred<FavoriteMutationResult>();
    const repository = echoingRepository();
    const musicRepository = {
      read: vi.fn().mockResolvedValue({
        albumIds: [],
        songIds: [],
        albums: [],
        tracks: [],
      }),
      write: vi.fn().mockImplementation((input: FavoriteInput) =>
        input.id === track.id ? firstWrite.promise : secondWrite.promise),
    };
    const { result, notify } = renderController(repository, vi.fn(), {
      musicRepository,
    });
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => {
      result.current.toggleFavorite(track.id, "song", true);
      result.current.toggleFavorite(secondTrack.id, "song", true);
    });
    await waitFor(() => {
      expect(result.current.favoriteTrackIds.has(secondTrack.id)).toBe(true);
    });

    await act(async () => {
      firstWrite.reject(new Error("Bandcamp rejected the star"));
      await expect(firstWrite.promise).rejects.toThrow("Bandcamp rejected the star");
    });
    await waitFor(() => {
      expect(result.current.favoriteTrackIds.has(track.id)).toBe(false);
      expect(result.current.favoriteTrackIds.has(secondTrack.id)).toBe(true);
      expect(notify).toHaveBeenCalledWith("Bandcamp rejected the star", "bad");
    });

    act(() => secondWrite.resolve(songMutation(secondTrack, true)));
    await waitFor(() => {
      expect(result.current.favoriteTrackIds.has(secondTrack.id)).toBe(true);
    });
  });

  it("keeps a Radio favorite saved while a track star is still confirming", async () => {
    const write = deferred<FavoriteMutationResult>();
    const repository = echoingRepository();
    const musicRepository = {
      read: vi.fn().mockResolvedValue({
        albumIds: [],
        songIds: [],
        albums: [],
        tracks: [],
      }),
      write: vi.fn().mockReturnValue(write.promise),
    };
    const { result } = renderController(repository, vi.fn(), { musicRepository });
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => result.current.toggleFavorite(track.id, "song", true));
    await waitFor(() => expect(result.current.favoriteTrackIds.has(track.id)).toBe(true));
    act(() => result.current.toggleRadioFavorite(radioShow, true));
    await waitFor(() => {
      expect(result.current.favoriteRadioShowIds.has(radioShow.id)).toBe(true);
    });

    act(() => write.resolve(songMutation(track, true)));
    await waitFor(() => {
      expect(result.current.favoriteTrackIds.has(track.id)).toBe(true);
      expect(result.current.favoriteRadioShowIds.has(radioShow.id)).toBe(true);
    });
    expect(repository.write).toHaveBeenCalledWith(expect.objectContaining({
      songIds: [track.id],
      radioShowIds: [radioShow.id],
    }));
  });

  it("restores an unverified unstar without dropping a concurrent Radio favorite", async () => {
    const write = deferred<FavoriteMutationResult>();
    const starredTrack = { ...track, starredAt: "2026-08-12T18:01:00Z" };
    const repository = echoingRepository({
      ...emptyLocalFavorites(),
      songIds: [track.id],
      tracks: [starredTrack],
    });
    const musicRepository: MusicFavoritesRepository = {
      read: vi.fn().mockResolvedValue({
        albumIds: [],
        songIds: [],
        albums: [],
        tracks: [],
      }),
      write: vi.fn().mockReturnValue(write.promise),
    };
    const { result, notify } = renderController(repository, vi.fn(), {
      musicRepository,
    });
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => result.current.toggleFavorite(track.id, "song", false));
    await waitFor(() => expect(result.current.favoriteTrackIds.has(track.id)).toBe(false));
    act(() => result.current.toggleRadioFavorite(radioShow, true));
    await waitFor(() => {
      expect(result.current.favoriteRadioShowIds.has(radioShow.id)).toBe(true);
    });

    act(() => write.resolve({
      accepted: true,
      verification: "unavailable",
    }));
    await waitFor(() => {
      expect(result.current.favoriteTrackIds.has(track.id)).toBe(true);
      expect(result.current.favoriteRadioShowIds.has(radioShow.id)).toBe(true);
      expect(notify).toHaveBeenCalledWith(
        "Bandcamp accepted the removal, but Coda could not verify it. The track will remain until Refresh confirms it.",
        "bad",
      );
    });
  });

  it("reconciles hydrated track stars again after disconnect and reconnect", async () => {
    const cachedAlbum: Album = {
      ...album,
      tracks: [{ ...track, starredAt: "2026-08-12T18:01:00Z" }],
    };
    const repository = echoingRepository();
    const reconcile = vi.fn().mockResolvedValue({
      tracks: [{ ...track, starredAt: "2026-08-12T18:01:00Z" }],
      unstarredIds: [],
      unavailableTrackCount: 0,
    });
    const musicRepository: MusicFavoritesRepository = {
      read: vi.fn().mockResolvedValue({
        albumIds: [],
        songIds: [],
        albums: [],
        tracks: [],
      }),
      write: vi.fn(),
      reconcile,
    };
    const notify = vi.fn();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result, rerender } = renderHook(
      ({ connected }: { connected: boolean }) => useLocalFavoritesController({
        albums: [cachedAlbum],
        connected,
        musicRepository,
        notify,
        queue: cachedAlbum.tracks ?? [],
        repository,
        selectedAlbum: cachedAlbum,
      }),
      {
        initialProps: { connected: true },
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      },
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    await waitFor(() => expect(reconcile).toHaveBeenCalled());
    const callsBeforeDisconnect = reconcile.mock.calls.length;

    rerender({ connected: false });
    await waitFor(() => expect(repository.write).toHaveBeenCalledWith(
      expect.objectContaining({ songIds: [], tracks: [] }),
    ));

    rerender({ connected: true });
    await waitFor(() => {
      expect(reconcile.mock.calls.length).toBeGreaterThan(callsBeforeDisconnect);
    });
  });

  it("notifies and retries when a getStarred merge exceeds the track bound", async () => {
    const boundTrack: Track = { ...track, id: "song-bound-0" };
    const overflow: Track = {
      ...track,
      id: "song-overflow",
      title: "Overflow",
      starredAt: "2026-08-12T18:03:00Z",
    };
    const songIds = Array.from(
      { length: MAX_FAVORITE_TRACKS },
      (_value, index) => `song-bound-${index}`,
    );
    const repository = echoingRepository({
      ...emptyLocalFavorites(),
      songIds,
    });
    const musicRepository = {
      read: vi.fn().mockResolvedValue({
        albumIds: [],
        songIds: [overflow.id],
        albums: [],
        tracks: [overflow],
      }),
      write: vi.fn().mockResolvedValue({
        accepted: true,
        verification: "verified",
        favorite: false,
      }),
    };
    const { result, notify } = renderController(repository, vi.fn(), {
      albums: [{ ...album, tracks: [boundTrack] }],
      musicRepository,
      queue: [boundTrack],
      selectedAlbum: { ...album, tracks: [boundTrack] },
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
    await waitFor(() => {
      expect(notify).toHaveBeenCalledWith(
        "Coda can save at most 25,000 favorite tracks.",
        "bad",
      );
    });
    expect(repository.write).not.toHaveBeenCalled();

    act(() => result.current.toggleFavorite(boundTrack.id, "song", false));
    await waitFor(() => {
      expect(repository.write).toHaveBeenCalledWith(expect.objectContaining({
        songIds: expect.arrayContaining([overflow.id]),
      }));
    });
    expect(result.current.ready).toBe(true);
  });

  it("discards a late track mutation that lost to a newer toggle", async () => {
    const starWrite = deferred<FavoriteMutationResult>();
    const unstarWrite = deferred<FavoriteMutationResult>();
    let localWriteCount = 0;
    const repository: LocalFavoritesRepository = {
      read: vi.fn().mockResolvedValue(emptyLocalFavorites()),
      write: vi.fn().mockImplementation(async (favorites) => {
        localWriteCount += 1;
        return favorites;
      }),
    };
    const musicRepository = {
      read: vi.fn().mockResolvedValue({
        albumIds: [],
        songIds: [],
        albums: [],
        tracks: [],
      }),
      write: vi.fn()
        .mockReturnValueOnce(starWrite.promise)
        .mockReturnValueOnce(unstarWrite.promise),
    };
    const { result, notify, queryClient } = renderController(repository, vi.fn(), {
      musicRepository,
    });
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => result.current.toggleFavorite(track.id, "song", true));
    await waitFor(() => expect(result.current.favoriteTrackIds.has(track.id)).toBe(true));
    act(() => result.current.toggleFavorite(track.id, "song", false));
    await waitFor(() => expect(result.current.favoriteTrackIds.has(track.id)).toBe(false));

    act(() => unstarWrite.resolve(songMutation(track, false)));
    await waitFor(() => {
      expect(notify).toHaveBeenCalledWith(
        "Removed from Bandcamp Subsonic Favorites",
        "good",
      );
    });
    expect(result.current.favoriteTrackIds.has(track.id)).toBe(false);
    const writesAfterUnstar = localWriteCount;

    act(() => starWrite.resolve(songMutation(track, true)));
    await waitFor(() => {
      expect(result.current.favoriteTrackIds.has(track.id)).toBe(false);
    });
    expect(notify).not.toHaveBeenCalledWith(
      "Saved to Bandcamp Subsonic Favorites",
      "good",
    );
    expect(localWriteCount).toBe(writesAfterUnstar);
    expect(queryClient.getQueryData<FavoriteCollection>(FAVORITES_QUERY_KEY)).toEqual(
      expect.objectContaining({
        songIds: [],
        tracks: [],
      }),
    );
  });

  it("discards a late hydrated reconciliation after a newer toggle and repairs on the next opportunity", async () => {
    const starredTrack = { ...track, starredAt: "2026-08-12T18:01:00Z" };
    const starredSecondTrack = {
      ...secondTrack,
      starredAt: "2026-08-12T18:02:00Z",
    };
    const cachedAlbum: Album = {
      ...album,
      tracks: [starredTrack, starredSecondTrack],
    };
    const repository = echoingRepository({
      ...emptyLocalFavorites(),
      songIds: [track.id, secondTrack.id],
      tracks: [starredTrack, starredSecondTrack],
    });
    const write = deferred<FavoriteMutationResult>();
    const reconcileCalls: Array<ReturnType<typeof deferred<FavoriteTrackReconciliation>>> = [];
    const musicRepository: MusicFavoritesRepository = {
      read: vi.fn().mockResolvedValue({
        albumIds: [],
        songIds: [],
        albums: [],
        tracks: [],
      }),
      write: vi.fn().mockReturnValue(write.promise),
      reconcile: vi.fn().mockImplementation(() => {
        const next = deferred<FavoriteTrackReconciliation>();
        reconcileCalls.push(next);
        return next.promise;
      }),
    };
    const { result } = renderController(repository, vi.fn(), {
      albums: [cachedAlbum],
      musicRepository,
      queue: cachedAlbum.tracks,
      selectedAlbum: cachedAlbum,
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
    await waitFor(() => expect(reconcileCalls.length).toBeGreaterThan(0));
    const staleReconcileCount = reconcileCalls.length;

    act(() => result.current.toggleFavorite(track.id, "song", false));
    await waitFor(() => expect(result.current.favoriteTrackIds.has(track.id)).toBe(false));
    act(() => write.resolve(songMutation(track, false)));
    await waitFor(() => {
      expect(result.current.favoriteTrackIds.has(track.id)).toBe(false);
      expect(result.current.favoriteTrackIds.has(secondTrack.id)).toBe(true);
    });

    act(() => {
      for (const pending of reconcileCalls.slice(0, staleReconcileCount)) {
        pending.resolve({
          tracks: [starredTrack, starredSecondTrack],
          unstarredIds: [],
          unavailableTrackCount: 0,
        });
      }
    });
    await waitFor(() => {
      expect(result.current.favoriteTrackIds.has(track.id)).toBe(false);
      expect(result.current.favoriteTrackIds.has(secondTrack.id)).toBe(true);
    });

    act(() => result.current.toggleRadioFavorite(radioShow, true));
    await waitFor(() => {
      expect(result.current.favoriteRadioShowIds.has(radioShow.id)).toBe(true);
      expect(reconcileCalls.length).toBeGreaterThan(staleReconcileCount);
    });

    const repairedSecondTrack = {
      ...starredSecondTrack,
      starredAt: "2026-08-13T00:00:00Z",
    };
    act(() => {
      for (const pending of reconcileCalls.slice(1)) {
        pending.resolve({
          tracks: [repairedSecondTrack],
          unstarredIds: [track.id],
          unavailableTrackCount: 0,
        });
      }
    });
    await waitFor(() => {
      expect(result.current.favoriteTrackIds.has(track.id)).toBe(false);
      expect(result.current.collection.tracks).toEqual([
        expect.objectContaining({
          id: secondTrack.id,
          starredAt: repairedSecondTrack.starredAt,
        }),
      ]);
    });
  });
});
