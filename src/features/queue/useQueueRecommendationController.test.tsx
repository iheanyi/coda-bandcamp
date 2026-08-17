import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Album, Track } from "@/types";

import { useQueueRecommendationController } from "./useQueueRecommendationController";

function album(id: string, genre = "Ambient"): Album {
  return {
    artist: `Artist ${id}`,
    duration: 720,
    genre,
    id,
    palette: ["#111", "#222"],
    songCount: 4,
    title: `Album ${id}`,
  };
}

const seedTrack: Track = {
  album: "Album seed",
  albumId: "seed",
  artist: "Artist seed",
  duration: 180,
  id: "track-seed",
  palette: ["#111", "#222"],
  title: "Seed",
  track: 1,
};

type RecommendationHookProps = {
  currentTrack?: Track;
  open: boolean;
};

describe("useQueueRecommendationController", () => {
  it("derives recommendations only while open and retains the last playback seed", () => {
    const albums = [album("seed"), album("next")];
    const onPlayRandomTrack = vi.fn();
    const onQueueAlbum = vi.fn().mockResolvedValue(true);
    const initialProps: RecommendationHookProps = {
      currentTrack: seedTrack,
      open: false,
    };
    const { result, rerender } = renderHook(
      ({ currentTrack, open }: RecommendationHookProps) =>
        useQueueRecommendationController({
          albums,
          currentTrack,
          favoriteAlbumIds: new Set(),
          onPlayRandomTrack,
          onQueueAlbum,
          open,
        }),
      {
        initialProps,
      },
    );

    expect(result.current.state.value).toBeUndefined();
    rerender({ currentTrack: seedTrack, open: true });
    const seededRecommendation = result.current.state.value;
    expect(seededRecommendation?.album.id).toBe("next");

    rerender({ currentTrack: undefined, open: true });
    expect(result.current.state.value).toEqual(seededRecommendation);

    act(() => result.current.commands.play());
    expect(onPlayRandomTrack).toHaveBeenCalledWith(
      [seededRecommendation?.album],
      seededRecommendation?.album.title,
    );
    expect(onQueueAlbum).not.toHaveBeenCalled();
  });

  it("serializes acceptance and advances only after queue hydration succeeds", async () => {
    let resolveQueue: ((added: boolean) => void) | undefined;
    const onQueueAlbum = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveQueue = resolve;
        }),
    );
    const { result } = renderHook(() =>
      useQueueRecommendationController({
        albums: [album("only")],
        favoriteAlbumIds: new Set(),
        onPlayRandomTrack: vi.fn(),
        onQueueAlbum,
        open: true,
      }),
    );

    let firstRequest: Promise<void> | undefined;
    await act(async () => {
      firstRequest = result.current.commands.addToQueue();
      void result.current.commands.addToQueue();
    });
    expect(onQueueAlbum).toHaveBeenCalledOnce();
    expect(result.current.state.queueLoading).toBe(true);

    resolveQueue?.(true);
    await act(async () => firstRequest);
    await waitFor(() => expect(result.current.state.queueLoading).toBe(false));
    expect(result.current.state.value).toBeUndefined();
  });

  it("keeps a recommendation available when queue hydration declines it", async () => {
    const recommendedAlbum = album("retry");
    const onQueueAlbum = vi.fn().mockResolvedValue(false);
    const { result } = renderHook(() =>
      useQueueRecommendationController({
        albums: [recommendedAlbum],
        favoriteAlbumIds: new Set(),
        onPlayRandomTrack: vi.fn(),
        onQueueAlbum,
        open: true,
      }),
    );

    await act(() => result.current.commands.addToQueue());

    expect(result.current.state.queueLoading).toBe(false);
    expect(result.current.state.value?.album).toEqual(recommendedAlbum);
  });
});
