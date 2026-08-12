import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterContextProvider } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { CodaMotionProvider } from "@/MotionProvider";
import { createCodaMemoryRouter } from "@/router";
import type { LocalFavoriteCollection } from "@/types";

const mocks = vi.hoisted(() => ({
  fetchCoverUrl: vi.fn(),
  invalidateCoverUrl: vi.fn(),
  readCachedCoverUrl: vi.fn(),
}));

vi.mock("@/lib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib")>();
  return {
    ...actual,
    fetchCoverUrl: mocks.fetchCoverUrl,
    invalidateCoverUrl: mocks.invalidateCoverUrl,
    readCachedCoverUrl: mocks.readCachedCoverUrl,
  };
});

import { FavoritesScreen } from "@/features/saved-library";

const directArtworkUrl = "https://bandcamp.com/direct-expired.jpg";
const refreshedArtworkUrl = "https://bandcamp.com/refreshed-cover.jpg";
const laterArtworkUrl = "https://bandcamp.com/later-direct-cover.jpg";

function favoriteCollection(artworkUrl?: string): LocalFavoriteCollection {
  return {
    albumIds: ["album-1"],
    albums: [
      {
        artist: "Sweeps",
        ...(artworkUrl ? { artworkUrl } : {}),
        coverArt: "album-cover-id",
        duration: 188,
        id: "album-1",
        palette: ["#a66", "#222"],
        songCount: 1,
        title: "Mirage",
      },
    ],
    radioShowIds: [],
    radioShows: [],
    songIds: [],
    tracks: [],
  };
}

const actions = {
  onAddToPlaylist: vi.fn(),
  onOpenAlbum: vi.fn(),
  onOpenArtist: vi.fn(),
  onOpenRadioSeries: vi.fn(),
  onOpenRadioShow: vi.fn(),
  onOpenTrackAlbum: vi.fn(),
  onPlayTrack: vi.fn(),
  onPlayTracks: vi.fn(),
  onQueueTrack: vi.fn(),
  onQueueTracks: vi.fn(),
  onRefreshFavorites: vi.fn(),
  onToggleFavorite: vi.fn(),
  onTogglePlayback: vi.fn(),
  onToggleRadioFavorite: vi.fn(),
};

function screenFor(favorites: LocalFavoriteCollection) {
  return (
    <FavoritesScreen
      {...actions}
      favorites={favorites}
      favoritesLoading={false}
      favoritesLocal
      onNotify={vi.fn()}
      playing={false}
    />
  );
}

beforeEach(() => {
  mocks.fetchCoverUrl.mockReset().mockResolvedValue(refreshedArtworkUrl);
  mocks.invalidateCoverUrl.mockReset();
  mocks.readCachedCoverUrl.mockReset().mockReturnValue(undefined);
  Object.values(actions).forEach((action) => action.mockReset());
});

it("exposes a stable return endpoint from the resolved cover cache on remount", () => {
  const cachedArtworkUrl = "https://bandcamp.com/cached-cover.jpg";
  mocks.readCachedCoverUrl.mockReturnValue(cachedArtworkUrl);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createCodaMemoryRouter(queryClient, ["/favorites"]);

  render(
    <CodaMotionProvider>
      <QueryClientProvider client={queryClient}>
        <RouterContextProvider router={router}>
          {screenFor(favoriteCollection())}
        </RouterContextProvider>
      </QueryClientProvider>
    </CodaMotionProvider>,
  );

  const artwork = screen
    .getByRole("link", { name: "Open Mirage" })
    .querySelector<HTMLElement>("[data-slot=cover]");
  const image = artwork?.querySelector("img");
  expect(artwork).toBeInTheDocument();
  expect(image).toHaveAttribute("src", cachedArtworkUrl);
  expect(image).not.toHaveClass("invisible");
  expect(
    artwork?.querySelector("[data-favorite-artwork-fallback]"),
  ).not.toBeInTheDocument();
});

it("does not reselect failed direct Favorite artwork and recovers through refreshed URLs", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createCodaMemoryRouter(queryClient, ["/favorites"]);
  const tree = (favorites: LocalFavoriteCollection) => (
    <CodaMotionProvider>
      <QueryClientProvider client={queryClient}>
        <RouterContextProvider router={router}>
          {screenFor(favorites)}
        </RouterContextProvider>
      </QueryClientProvider>
    </CodaMotionProvider>
  );
  const view = render(tree(favoriteCollection(directArtworkUrl)));
  const releaseLink = screen.getByRole("link", { name: "Open Mirage" });
  expect(releaseLink).toHaveAttribute(
    "href",
    "/collection/albums/album-1?q=&genre=All&sort=recent&mode=releases",
  );
  let artwork = releaseLink.querySelector<HTMLElement>("[aria-hidden=true]");
  const expiredImage = artwork?.querySelector("img");
  expect(expiredImage).toHaveAttribute("src", directArtworkUrl);
  if (!expiredImage) throw new Error("Expected direct Favorite artwork.");

  fireEvent.error(expiredImage);
  expect(mocks.invalidateCoverUrl).toHaveBeenCalledWith("album-cover-id");
  await waitFor(
    () => expect(mocks.fetchCoverUrl).toHaveBeenCalledWith("album-cover-id"),
    { timeout: 500 },
  );
  await waitFor(() => {
    artwork = screen
      .getByRole("link", { name: "Open Mirage" })
      .querySelector<HTMLElement>("[aria-hidden=true]");
    expect(artwork?.querySelector("img")).toHaveAttribute(
      "src",
      refreshedArtworkUrl,
    );
  });
  expect(
    artwork?.querySelector(`[src="${directArtworkUrl}"]`),
  ).not.toBeInTheDocument();
  const refreshedImage = artwork?.querySelector("img");
  expect(refreshedImage).toHaveClass("invisible");
  expect(
    artwork?.querySelector("[data-favorite-artwork-fallback]"),
  ).toBeInTheDocument();
  if (!refreshedImage) throw new Error("Expected refreshed Favorite artwork.");

  fireEvent.load(refreshedImage);
  expect(refreshedImage).not.toHaveClass("invisible");
  expect(
    artwork?.querySelector("[data-favorite-artwork-fallback]"),
  ).not.toBeInTheDocument();

  view.rerender(tree(favoriteCollection(laterArtworkUrl)));
  artwork = screen
    .getByRole("link", { name: "Open Mirage" })
    .querySelector<HTMLElement>("[aria-hidden=true]");
  const laterImage = artwork?.querySelector("img");
  expect(laterImage).toHaveAttribute("src", laterArtworkUrl);
  expect(laterImage).toHaveClass("invisible");
  expect(
    artwork?.querySelector("[data-favorite-artwork-fallback]"),
  ).toBeInTheDocument();
  if (!laterImage) throw new Error("Expected later Favorite artwork.");

  fireEvent.load(laterImage);
  expect(laterImage).not.toHaveClass("invisible");
  expect(
    artwork?.querySelector("[data-favorite-artwork-fallback]"),
  ).not.toBeInTheDocument();
  expect(
    view.container.querySelector("a a, a button, button a"),
  ).not.toBeInTheDocument();
});
