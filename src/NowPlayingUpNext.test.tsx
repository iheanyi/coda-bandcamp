import { QueryClient } from "@tanstack/react-query";
import { RouterContextProvider } from "@tanstack/react-router";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { expect, it, vi } from "vitest";

import { createCodaMemoryRouter } from "@/router";
import type { Album, Track } from "@/types";

import { NowPlayingUpNext } from "./NowPlayingUpNext";

function libraryTrack(index: number): Track {
  return {
    id: `track-${index}`,
    title: `Track ${index}`,
    artist: `Artist ${index}`,
    album: `Album ${index}`,
    albumId: `album-${index}`,
    duration: 180 + index,
    track: index,
    palette: ["#345", "#123"],
  };
}

const defaultProps: ComponentProps<typeof NowPlayingUpNext> = {
  queue: [libraryTrack(0)],
  currentIndex: 0,
  hasDeferredTracks: false,
  recommendationLoading: false,
  recommendationQueueLoading: false,
  onPlayRecommendation: vi.fn(),
  onAnotherRecommendation: vi.fn(),
  onPlayQueueIndex: vi.fn(),
  onArtist: vi.fn(),
  onAlbum: vi.fn(),
  onRadioSeries: vi.fn(),
};

function renderWithRouter(
  ui: ReactNode,
  initialPath = "/now-playing",
) {
  const router = createCodaMemoryRouter(new QueryClient(), [initialPath]);
  return render(ui, {
    wrapper: ({ children }) => (
      <RouterContextProvider router={router}>{children}</RouterContextProvider>
    ),
  });
}

it("bounds the upcoming preview while preserving queue indexes", () => {
  const onPlayQueueIndex = vi.fn();
  renderWithRouter(
    <NowPlayingUpNext
      {...defaultProps}
      queue={Array.from({ length: 6 }, (_, index) => libraryTrack(index))}
      onPlayQueueIndex={onPlayQueueIndex}
    />,
  );

  expect(screen.getByRole("heading", { name: "Up next" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Play Track 4" })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Play Track 5" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("1 more in the full queue")).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "Play Track 4" }));
  expect(onPlayQueueIndex).toHaveBeenCalledWith(4);
});

it("offers a continuation when the current queue is complete", () => {
  const album: Album = {
    id: "album-22",
    title: "Soft Focus",
    artist: "Night Archive",
    songCount: 8,
    duration: 2_104,
    genre: "Ambient",
    palette: ["#6f6d86", "#1a1b25"],
  };
  const onQueueRecommendation = vi.fn();
  const onPlayRecommendation = vi.fn();
  const onAnotherRecommendation = vi.fn();

  renderWithRouter(
    <NowPlayingUpNext
      {...defaultProps}
      recommendation={{
        album,
        reason: "Another Ambient pick",
      }}
      recommendationArtwork={<span>Suggested artwork</span>}
      onQueueRecommendation={onQueueRecommendation}
      onPlayRecommendation={onPlayRecommendation}
      onAnotherRecommendation={onAnotherRecommendation}
    />,
  );

  expect(
    screen.getByRole("heading", { name: "Keep listening" }),
  ).toBeVisible();
  expect(screen.getByText("Picked from your collection")).toBeVisible();

  fireEvent.click(
    screen.getByRole("button", { name: "Add Soft Focus to queue" }),
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: "Play something from Soft Focus",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Another pick" }));

  expect(onQueueRecommendation).toHaveBeenCalledOnce();
  expect(onPlayRecommendation).toHaveBeenCalledOnce();
  expect(onAnotherRecommendation).toHaveBeenCalledOnce();
});
