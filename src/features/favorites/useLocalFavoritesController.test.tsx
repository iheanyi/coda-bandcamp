import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { emptyLocalFavorites } from "@/localFavorites";
import type {
  Album,
  FavoriteInput,
  FavoriteMutationResult,
  LocalFavoriteCollection,
  Track,
} from "@/types";
import {
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

const album: Album = {
  id: "album-1",
  title: "Blue Hours",
  artist: "Signal Garden",
  songCount: 1,
  duration: 201,
  tracks: [track],
  palette: ["#777", "#222"],
};

function successfulMutation(
  input: FavoriteInput,
): FavoriteMutationResult {
  if (input.kind === "album") {
    return {
      accepted: true,
      verification: "notRequired",
      favorite: input.favorite,
    };
  }
  const favoriteTrack: Track = { ...track };
  if (input.favorite) {
    favoriteTrack.starredAt = "2026-08-12T18:01:00Z";
  }
  return {
    accepted: true,
    verification: "verified",
    favorite: input.favorite,
    track: favoriteTrack,
  };
}

const radioShow = {
  id: 42,
  subtitle: "The Hip Hop Show",
  description: "New favorites from around the world.",
  publishedAt: "2026-08-10T12:00:00Z",
};

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
    write: vi.fn().mockImplementation(async (input) => successfulMutation(input)),
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const rendered = renderHook(() => useLocalFavoritesController({
    albums: options.albums ?? [album],
    connected: options.connected ?? true,
    musicRepository,
    notify,
    queue: options.queue ?? [track],
    repository,
    selectedAlbum: options.selectedAlbum ?? album,
  }), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
  return { ...rendered, notify, queryClient };
}

describe("useLocalFavoritesController", () => {
  it("loads local Radio favorites without querying Bandcamp while disconnected", async () => {
    const repository: LocalFavoritesRepository = {
      read: vi.fn().mockResolvedValue({
        ...emptyLocalFavorites(),
        radioShowIds: [radioShow.id],
        radioShows: [radioShow],
      }),
      write: vi.fn(),
    };
    const musicRepository = {
      read: vi.fn(),
      write: vi.fn(),
    };

    const { result } = renderController(repository, vi.fn(), {
      connected: false,
      musicRepository,
    });

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(musicRepository.read).not.toHaveBeenCalled();
    expect(result.current.favoriteRadioShowIds.has(radioShow.id)).toBe(true);
    expect(result.current.favoriteAlbumIds.size).toBe(0);
    expect(result.current.favoriteTrackIds.size).toBe(0);
  });

  it("combines Bandcamp music favorites with device-local Radio favorites", async () => {
    const repository: LocalFavoritesRepository = {
      read: vi.fn().mockResolvedValue({
        ...emptyLocalFavorites(),
        albumIds: ["legacy-local-album"],
        radioShowIds: [radioShow.id],
        radioShows: [radioShow],
      }),
      write: vi.fn(),
    };
    const musicRepository = {
      read: vi.fn().mockResolvedValue({
        albumIds: [album.id],
        songIds: [track.id],
        albums: [{ ...album, artist: "Unknown artist", tracks: undefined }],
        tracks: [track],
      }),
      write: vi.fn(),
    };

    const { result } = renderController(repository, vi.fn(), {
      connected: true,
      musicRepository,
    });

    await waitFor(() => expect(result.current.ready).toBe(true), { timeout: 500 });

    expect(result.current.collection).toEqual({
      albumIds: [album.id],
      songIds: [track.id],
      albums: [album],
      tracks: [track],
      radioShowIds: [radioShow.id],
      radioShows: [radioShow],
    });
  });

  it("keeps Radio favorite mutations device-local", async () => {
    const repository: LocalFavoritesRepository = {
      read: vi.fn().mockResolvedValue({
        ...emptyLocalFavorites(),
        albumIds: ["legacy-local-album"],
        songIds: ["legacy-local-song"],
        albums: [{ ...album, id: "legacy-local-album" }],
        tracks: [{ ...track, id: "legacy-local-song" }],
      }),
      write: vi.fn().mockImplementation(async (favorites) => favorites),
    };
    const musicRepository = {
      read: vi.fn().mockResolvedValue({
        albumIds: [],
        songIds: [],
        albums: [],
        tracks: [],
      }),
      write: vi.fn(),
    };
    const { result, notify } = renderController(repository, vi.fn(), {
      musicRepository,
    });
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => result.current.toggleRadioFavorite(radioShow, true));

    await waitFor(() => {
      expect(result.current.favoriteRadioShowIds.has(radioShow.id)).toBe(true);
    });
    expect(repository.write).toHaveBeenCalledWith(expect.objectContaining({
      albumIds: [],
      songIds: ["legacy-local-song"],
      albums: [],
      tracks: [expect.objectContaining({ id: "legacy-local-song" })],
      radioShowIds: [radioShow.id],
      radioShows: [radioShow],
    }));
    expect(musicRepository.write).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      "Radio show saved to Favorites on this device",
      "good",
    );
  });

  it("finishes readiness with a retryable error when the initial read fails", async () => {
    const repository: LocalFavoritesRepository = {
      read: vi.fn().mockRejectedValue(new Error("Local Favorites are unavailable")),
      write: vi.fn(),
    };
    const { result, notify } = renderController(repository);

    await waitFor(() => expect(result.current.ready).toBe(true));

    expect(result.current.collection).toEqual(emptyLocalFavorites());
    expect(result.current.loadError).toBe("Local Favorites are unavailable");
    expect(notify).toHaveBeenCalledWith(
      "Local Favorites are unavailable",
      "bad",
    );
  });

  it("surfaces a Bandcamp Favorites query error for retry", async () => {
    const repository: LocalFavoritesRepository = {
      read: vi.fn().mockResolvedValue(emptyLocalFavorites()),
      write: vi.fn().mockImplementation(async (favorites) => favorites),
    };
    const musicRepository = {
      read: vi.fn().mockRejectedValue(new Error("Bandcamp Favorites are unavailable")),
      write: vi.fn(),
    };
    const { result } = renderController(repository, vi.fn(), {
      musicRepository,
    });

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.loadError).toBe("Bandcamp Favorites are unavailable");
    expect(result.current.collection).toEqual(emptyLocalFavorites());
  });

  it("ignores a stale refresh result", async () => {
    const first = deferred<LocalFavoriteCollection>();
    const second = deferred<LocalFavoriteCollection>();
    const repository: LocalFavoritesRepository = {
      read: vi.fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise),
      write: vi.fn(),
    };
    const { result } = renderController(repository);

    act(() => result.current.refresh());
    await act(async () => {
      second.resolve({
        ...emptyLocalFavorites(),
        radioShowIds: [radioShow.id],
        radioShows: [radioShow],
      });
      await second.promise;
    });
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      first.resolve(emptyLocalFavorites());
      await first.promise;
    });
    expect(result.current.collection.radioShowIds).toEqual([radioShow.id]);
  });

  it("rolls back the latest optimistic favorite and withholds success on write failure", async () => {
    const write = deferred<FavoriteMutationResult>();
    const repository: LocalFavoritesRepository = {
      read: vi.fn().mockResolvedValue(emptyLocalFavorites()),
      write: vi.fn(),
    };
    const musicRepository = {
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
    expect(musicRepository.read).toHaveBeenCalledTimes(1);

    act(() => result.current.toggleFavorite(album.id, "album"));
    await waitFor(() => {
      expect(result.current.favoriteAlbumIds.has(album.id)).toBe(true);
    });

    await act(async () => {
      write.reject(new Error("Bandcamp rejected the star"));
      await expect(write.promise).rejects.toThrow("Bandcamp rejected the star");
    });
    await waitFor(() => {
      expect(result.current.favoriteAlbumIds.has(album.id)).toBe(false);
    });
    expect(musicRepository.write).toHaveBeenCalledWith({
      id: album.id,
      kind: "album",
      favorite: true,
    });
    expect(notify).toHaveBeenCalledWith("Bandcamp rejected the star", "bad");
    expect(notify).not.toHaveBeenCalledWith(
      "Saved to Bandcamp Subsonic Favorites",
      "good",
    );
  });

  it("refetches authoritative Bandcamp favorites and announces only after success", async () => {
    const write = deferred<FavoriteMutationResult>();
    const authoritative = {
      albumIds: [album.id],
      songIds: [],
      albums: [{
        ...album,
        title: "Blue Hours (Bandcamp)",
        tracks: undefined,
      }],
      tracks: [],
    };
    const repository: LocalFavoritesRepository = {
      read: vi.fn().mockResolvedValue(emptyLocalFavorites()),
      write: vi.fn().mockImplementation(async (favorites) => favorites),
    };
    const musicRepository = {
      read: vi.fn()
        .mockResolvedValueOnce({
          albumIds: [],
          songIds: [],
          albums: [],
          tracks: [],
        })
        .mockResolvedValue(authoritative),
      write: vi.fn().mockReturnValue(write.promise),
    };
    const { result, notify } = renderController(repository, vi.fn(), {
      musicRepository,
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(musicRepository.read).toHaveBeenCalledTimes(1);

    act(() => result.current.toggleFavorite(album.id, "album"));
    await waitFor(() => {
      expect(result.current.collection.albums).toEqual([album]);
    }, { timeout: 500 });
    expect(notify).not.toHaveBeenCalledWith(
      "Saved to Bandcamp Subsonic Favorites",
      "good",
    );

    act(() => write.resolve(successfulMutation({
      id: album.id,
      kind: "album",
      favorite: true,
    })));

    await waitFor(() => {
      expect(musicRepository.read).toHaveBeenCalledTimes(2);
      expect(result.current.collection.albums).toEqual([album]);
    }, { timeout: 500 });
    expect(notify).toHaveBeenCalledWith(
      "Saved to Bandcamp Subsonic Favorites",
      "good",
    );
  });

  it("keeps a successfully starred track when getStarred refetches with no songs", async () => {
    const emptyServerFavorites = {
      albumIds: [],
      songIds: [],
      albums: [],
      tracks: [],
    };
    const repository: LocalFavoritesRepository = {
      read: vi.fn().mockResolvedValue(emptyLocalFavorites()),
      write: vi.fn().mockImplementation(async (favorites) => favorites),
    };
    const musicRepository = {
      read: vi.fn().mockResolvedValue(emptyServerFavorites),
      write: vi.fn().mockImplementation(async (input) => successfulMutation(input)),
    };
    const { result } = renderController(repository, vi.fn(), {
      musicRepository,
    });
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => result.current.toggleFavorite(track.id, "song", true));

    await waitFor(() => {
      expect(musicRepository.read).toHaveBeenCalledTimes(2);
    });
    expect(result.current.favoriteTrackIds.has(track.id)).toBe(true);
    expect(result.current.collection.tracks).toEqual([expect.objectContaining({
      ...track,
      starredAt: "2026-08-12T18:01:00Z",
    })]);
    expect(musicRepository.write).toHaveBeenCalledWith({
      id: track.id,
      albumId: album.id,
      kind: "song",
      favorite: true,
    });
    expect(repository.write).toHaveBeenCalledWith(expect.objectContaining({
      albumIds: [],
      albums: [],
      songIds: [track.id],
      tracks: [expect.objectContaining({
        id: track.id,
        starredAt: "2026-08-12T18:01:00Z",
      })],
    }));
  });

  it("validates cached album track stars before adding them to the index", async () => {
    const secondTrack: Track = {
      ...track,
      id: "track-2",
      title: "Afterimage",
      track: 2,
      starredAt: "2026-08-12T18:02:00Z",
    };
    const cachedAlbum: Album = {
      ...album,
      songCount: 2,
      tracks: [
        { ...track, starredAt: "2026-08-12T18:01:00Z" },
        secondTrack,
      ],
    };
    const repository: LocalFavoritesRepository = {
      read: vi.fn().mockResolvedValue(emptyLocalFavorites()),
      write: vi.fn().mockImplementation(async (favorites) => favorites),
    };
    const reconcile = vi.fn().mockResolvedValue({
      tracks: [{ ...track, starredAt: "2026-08-12T18:01:00Z" }],
      unstarredIds: [secondTrack.id],
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
    const { result } = renderController(repository, vi.fn(), {
      albums: [cachedAlbum],
      musicRepository,
      queue: cachedAlbum.tracks,
      selectedAlbum: cachedAlbum,
    });
    await waitFor(() => expect(result.current.ready).toBe(true));

    await waitFor(() => {
      expect(reconcile).toHaveBeenCalledWith([
        { id: track.id, albumId: album.id },
        { id: secondTrack.id, albumId: album.id },
      ]);
    });
    await waitFor(() => {
      expect(result.current.collection.tracks).toEqual([
        expect.objectContaining({ id: track.id }),
      ]);
    });
  });

  it("keeps a track indexed when Bandcamp accepts unstar but verification is unavailable", async () => {
    const starredTrack = {
      ...track,
      starredAt: "2026-08-12T18:01:00Z",
    };
    const repository: LocalFavoritesRepository = {
      read: vi.fn().mockResolvedValue({
        ...emptyLocalFavorites(),
        songIds: [track.id],
        tracks: [starredTrack],
      }),
      write: vi.fn().mockImplementation(async (favorites) => favorites),
    };
    const musicRepository: MusicFavoritesRepository = {
      read: vi.fn().mockResolvedValue({
        albumIds: [],
        songIds: [],
        albums: [],
        tracks: [],
      }),
      write: vi.fn().mockResolvedValue({
        accepted: true,
        verification: "unavailable",
      }),
    };
    const notify = vi.fn();
    const { result } = renderController(repository, notify, { musicRepository });
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => result.current.toggleFavorite(track.id, "song", false));

    await waitFor(() => {
      expect(result.current.favoriteTrackIds.has(track.id)).toBe(true);
      expect(notify).toHaveBeenCalledWith(
        "Bandcamp accepted the removal, but Coda could not verify it. The track will remain until Refresh confirms it.",
        "bad",
      );
    });
    expect(notify).not.toHaveBeenCalledWith(
      "Removed from Bandcamp Subsonic Favorites",
      "good",
    );
  });

  it("rolls back a rejected track unstar", async () => {
    const starredTrack = {
      ...track,
      starredAt: "2026-08-12T18:01:00Z",
    };
    const repository: LocalFavoritesRepository = {
      read: vi.fn().mockResolvedValue({
        ...emptyLocalFavorites(),
        songIds: [track.id],
        tracks: [starredTrack],
      }),
      write: vi.fn().mockImplementation(async (favorites) => favorites),
    };
    const musicRepository: MusicFavoritesRepository = {
      read: vi.fn().mockResolvedValue({
        albumIds: [],
        songIds: [],
        albums: [],
        tracks: [],
      }),
      write: vi.fn().mockRejectedValue(new Error("Bandcamp rejected the unstar")),
    };
    const notify = vi.fn();
    const { result } = renderController(repository, notify, { musicRepository });
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => result.current.toggleFavorite(track.id, "song", false));

    await waitFor(() => {
      expect(result.current.favoriteTrackIds.has(track.id)).toBe(true);
      expect(notify).toHaveBeenCalledWith("Bandcamp rejected the unstar", "bad");
    });
  });

  it("revalidates only indexed tracks during Refresh", async () => {
    const starredTrack = {
      ...track,
      starredAt: "2026-08-12T18:01:00Z",
    };
    const repository: LocalFavoritesRepository = {
      read: vi.fn().mockResolvedValue({
        ...emptyLocalFavorites(),
        songIds: [track.id],
        tracks: [starredTrack],
      }),
      write: vi.fn().mockImplementation(async (favorites) => favorites),
    };
    const reconcile = vi.fn().mockResolvedValue({
      tracks: [],
      unstarredIds: [track.id],
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
    const { result } = renderController(repository, vi.fn(), { musicRepository });
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => result.current.refresh());

    await waitFor(() => {
      expect(result.current.favoriteTrackIds.has(track.id)).toBe(false);
    });
    expect(reconcile).toHaveBeenCalledWith([{
      id: track.id,
      albumId: album.id,
    }]);
  });

  it("clears the account track-star index on disconnect but preserves Radio favorites", async () => {
    const starredTrack = {
      ...track,
      starredAt: "2026-08-12T18:01:00Z",
    };
    const repository: LocalFavoritesRepository = {
      read: vi.fn().mockResolvedValue({
        ...emptyLocalFavorites(),
        songIds: [track.id],
        tracks: [starredTrack],
        radioShowIds: [radioShow.id],
        radioShows: [radioShow],
      }),
      write: vi.fn().mockImplementation(async (favorites) => favorites),
    };
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const musicRepository: MusicFavoritesRepository = {
      read: vi.fn().mockResolvedValue({
        albumIds: [],
        songIds: [],
        albums: [],
        tracks: [],
      }),
      write: vi.fn(),
    };
    const notify = vi.fn();
    const { result, rerender } = renderHook(
      ({ connected }: { connected: boolean }) => useLocalFavoritesController({
        albums: [album],
        connected,
        musicRepository,
        notify,
        queue: [track],
        repository,
        selectedAlbum: album,
      }),
      {
        initialProps: { connected: true },
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      },
    );
    await waitFor(() => expect(result.current.ready).toBe(true));

    rerender({ connected: false });

    await waitFor(() => expect(repository.write).toHaveBeenCalledWith(
      expect.objectContaining({
        songIds: [],
        tracks: [],
        radioShowIds: [radioShow.id],
        radioShows: [radioShow],
      }),
    ));
  });

  it("rolls back only the failed item after another mutation has synchronized", async () => {
    const failedWrite = deferred<FavoriteMutationResult>();
    const successfulWrite = deferred<FavoriteMutationResult>();
    const authoritative = {
      albumIds: [],
      songIds: [track.id],
      albums: [],
      tracks: [{ ...track, title: "Glass Lines (Bandcamp)" }],
    };
    const repository: LocalFavoritesRepository = {
      read: vi.fn().mockResolvedValue(emptyLocalFavorites()),
      write: vi.fn().mockImplementation(async (favorites) => favorites),
    };
    const musicRepository = {
      read: vi.fn()
        .mockResolvedValueOnce({
          albumIds: [],
          songIds: [],
          albums: [],
          tracks: [],
        })
        .mockResolvedValue(authoritative),
      write: vi.fn().mockImplementation((input) =>
        input.kind === "album" ? failedWrite.promise : successfulWrite.promise),
    };
    const { result } = renderController(repository, vi.fn(), {
      musicRepository,
    });
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => result.current.toggleFavorite(album.id, "album", true));
    await waitFor(() => expect(result.current.favoriteAlbumIds.has(album.id)).toBe(true));
    act(() => result.current.toggleFavorite(track.id, "song", true));
    await waitFor(() => expect(result.current.favoriteTrackIds.has(track.id)).toBe(true));

    act(() => successfulWrite.resolve(successfulMutation({
      id: track.id,
      kind: "song",
      favorite: true,
      albumId: album.id,
    })));
    await waitFor(() => {
      expect(musicRepository.read).toHaveBeenCalledTimes(2);
    });
    expect(result.current.collection.tracks[0]?.title).toBe(
      "Glass Lines (Bandcamp)",
    );

    await act(async () => {
      failedWrite.reject(new Error("Bandcamp rejected the album star"));
      await expect(failedWrite.promise).rejects.toThrow(
        "Bandcamp rejected the album star",
      );
    });

    await waitFor(() => {
      expect(result.current.favoriteAlbumIds.has(album.id)).toBe(false);
      expect(result.current.favoriteTrackIds.has(track.id)).toBe(true);
    });
    expect(result.current.collection.tracks[0]?.title).toBe(
      "Glass Lines (Bandcamp)",
    );
  });
});
