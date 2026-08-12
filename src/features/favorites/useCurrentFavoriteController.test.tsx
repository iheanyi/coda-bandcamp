import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { RadioShow, Track } from "@/types";

import { useCurrentFavoriteController } from "./useCurrentFavoriteController";

const track: Track = {
  album: "Soft Focus",
  albumId: "album-1",
  artist: "Night Archive",
  duration: 180,
  id: "track-1",
  palette: ["#111", "#222"],
  title: "Static Bloom",
  track: 1,
};

function wrapper(queryClient: QueryClient) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

function favorites() {
  return {
    ensureReady: vi.fn(() => true),
    toggleFavorite: vi.fn(),
    toggleRadioFavorite: vi.fn(),
  };
}

describe("useCurrentFavoriteController", () => {
  it("toggles ordinary current tracks without fetching Radio metadata", () => {
    const queryClient = new QueryClient();
    const favoriteActions = favorites();
    const { result } = renderHook(
      () =>
        useCurrentFavoriteController({
          currentTrack: track,
          favorites: favoriteActions,
          notify: vi.fn(),
        }),
      { wrapper: wrapper(queryClient) },
    );

    act(() => result.current.toggle());
    expect(favoriteActions.toggleFavorite).toHaveBeenCalledWith(
      track.id,
      "song",
    );
    expect(favoriteActions.toggleRadioFavorite).not.toHaveBeenCalled();
  });

  it("reuses cached Radio metadata for a current show favorite", async () => {
    const queryClient = new QueryClient();
    const show: RadioShow = {
      chapters: [],
      description: "Late-night selections",
      duration: 3600,
      id: 979,
      publishedAt: "2026-08-01T00:00:00Z",
      streamUrl: "https://t4.bcbits.com/stream/show",
      subtitle: "Episode 979",
      title: "Bandcamp Weekly",
    };
    queryClient.setQueryData(["bandcamp-radio-show", show.id], show);
    const favoriteActions = favorites();
    const { result } = renderHook(
      () =>
        useCurrentFavoriteController({
          currentTrack: { ...track, id: "radio:979" },
          favorites: favoriteActions,
          notify: vi.fn(),
        }),
      { wrapper: wrapper(queryClient) },
    );

    act(() => result.current.toggle());
    await waitFor(() => {
      expect(favoriteActions.toggleRadioFavorite).toHaveBeenCalledWith(show);
    });
    expect(favoriteActions.toggleFavorite).not.toHaveBeenCalled();
  });
});
