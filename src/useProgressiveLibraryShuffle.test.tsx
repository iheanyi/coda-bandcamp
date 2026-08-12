import { act, renderHook, waitFor } from "@testing-library/react";
import { useCallback, useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Album, Track } from "./types";
import {
  useProgressiveLibraryShuffle,
  type ProgressiveLibraryShufflePlayerMutation,
} from "./useProgressiveLibraryShuffle";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const albums: Album[] = Array.from({ length: 6 }, (_, index) => ({
  id: `album-${index}`,
  title: `Album ${index}`,
  artist: "Shuffle Artist",
  songCount: 1,
  duration: 180,
  palette: ["#777", "#222"],
}));

function trackFor(album: Album): Track {
  return {
    id: `track-${album.id}`,
    title: `Track for ${album.title}`,
    artist: album.artist,
    album: album.title,
    albumId: album.id,
    duration: 180,
    track: 1,
    palette: album.palette,
  };
}

function useShuffleHarness(
  loadAlbumTracks: (album: Album) => Promise<Track[]>,
  onCommit: (mutation: ProgressiveLibraryShufflePlayerMutation) => void,
  notify: (message: string, tone?: "good" | "bad") => void,
) {
  const [queue, setQueue] = useState<Track[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const playerRef = useRef({ queue, currentIndex, repeatMode: "off" as const });
  playerRef.current = { queue, currentIndex, repeatMode: "off" };
  const getConnectionGeneration = useCallback(() => 0, []);
  const getPlayerState = useCallback(() => playerRef.current, []);
  const recoverAlbum = useCallback((album: Album) => album, []);
  const applyRecoveredAlbums = useCallback(() => undefined, []);
  const commitPlayerMutation = useCallback((
    mutation: ProgressiveLibraryShufflePlayerMutation,
  ) => {
    onCommit(mutation);
    setQueue(mutation.queue);
    setCurrentIndex(mutation.currentIndex);
    if (mutation.playing !== undefined) setPlaying(mutation.playing);
  }, [onCommit]);
  const controller = useProgressiveLibraryShuffle({
    connected: true,
    queue,
    currentIndex,
    playing,
    getConnectionGeneration,
    loadAlbumTracks,
    recoverAlbum,
    applyRecoveredAlbums,
    getPlayerState,
    commitPlayerMutation,
    notify,
  });
  return { controller, queue, currentIndex, playing };
}

describe("useProgressiveLibraryShuffle", () => {
  it("commits the first playable track immediately", async () => {
    const commit = vi.fn();
    const notify = vi.fn();
    const loadAlbumTracks = vi.fn(async (album: Album) => [trackFor(album)]);
    const { result } = renderHook(() =>
      useShuffleHarness(loadAlbumTracks, commit, notify)
    );

    act(() => result.current.controller.shuffle([albums[0]], "collection"));

    await waitFor(() => expect(result.current.queue).toEqual([
      trackFor(albums[0]),
    ]));
    expect(result.current.playing).toBe(true);
    expect(commit).toHaveBeenCalledWith({
      queue: [trackFor(albums[0])],
      currentIndex: 0,
      playing: true,
      resetPlayback: true,
    });
    expect(notify).toHaveBeenCalledWith("Shuffling collection", "good");
    expect(result.current.controller.progress).toBeUndefined();
    expect(result.current.controller.hasMore).toBe(false);
  });

  it("bounds hydration at four and ignores results after cancellation", async () => {
    const requests = new Map(albums.map((album) => [
      album.id,
      deferred<Track[]>(),
    ]));
    const commit = vi.fn();
    const notify = vi.fn();
    const loadAlbumTracks = vi.fn((album: Album) =>
      requests.get(album.id)!.promise
    );
    const { result } = renderHook(() =>
      useShuffleHarness(loadAlbumTracks, commit, notify)
    );

    act(() => result.current.controller.shuffle(albums, "collection"));
    await waitFor(() => expect(loadAlbumTracks).toHaveBeenCalledTimes(4));
    expect(result.current.controller.progress).toEqual({ done: 0, total: 6 });

    act(() => result.current.controller.cancel());
    await act(async () => {
      for (const [album] of loadAlbumTracks.mock.calls) {
        requests.get(album.id)!.resolve([trackFor(album)]);
      }
      await Promise.resolve();
    });

    expect(commit).not.toHaveBeenCalled();
    expect(result.current.queue).toEqual([]);
    expect(result.current.controller.progress).toBeUndefined();
    expect(result.current.controller.hasMore).toBe(false);
  });
});
