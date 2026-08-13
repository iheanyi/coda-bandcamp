import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterContextProvider } from "@tanstack/react-router";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { CodaMotionProvider } from "@/MotionProvider";
import { createCodaMemoryRouter } from "@/router";
import type { LocalFavoriteCollection } from "@/types";

const mocks = vi.hoisted(() => ({
  convertFileSrc: vi.fn(
    (path: string, protocol: string) => `${protocol}:${path}`,
  ),
  invoke: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  listen: vi.fn(() => Promise.resolve(() => undefined)),
}));

vi.mock("@tauri-apps/api/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tauri-apps/api/core")>();
  return {
    ...actual,
    convertFileSrc: mocks.convertFileSrc,
    invoke: mocks.invoke,
  };
});

vi.mock("@tauri-apps/api/event", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tauri-apps/api/event")>();
  return { ...actual, listen: mocks.listen };
});

import { clearCoverArtRendererState } from "@/coverArtSource";
import { CoverArt } from "@/features/artwork/CoverArt";
import { FavoritesScreen } from "@/features/saved-library";

const directArtworkUrl = "https://bandcamp.com/direct-expired.jpg";
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

function testTree(
  queryClient: QueryClient,
  favorites: LocalFavoriteCollection,
) {
  const router = createCodaMemoryRouter(queryClient, ["/favorites"]);
  return (
    <CodaMotionProvider>
      <QueryClientProvider client={queryClient}>
        <RouterContextProvider router={router}>
          {screenFor(favorites)}
        </RouterContextProvider>
      </QueryClientProvider>
    </CodaMotionProvider>
  );
}

beforeEach(() => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
  act(() => clearCoverArtRendererState());
  mocks.convertFileSrc.mockClear();
  mocks.invoke.mockClear().mockResolvedValue(undefined);
  Object.values(actions).forEach((action) => action.mockReset());
});

it("reveals cold authenticated Favorite artwork over its base color", () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  render(testTree(queryClient, favoriteCollection()));

  const artwork = screen
    .getByRole("link", { name: "Open Mirage" })
    .querySelector<HTMLElement>("[data-slot=cover]");
  const image = artwork?.querySelector("img");
  expect(image?.getAttribute("src")).toMatch(
    /^coda-cover:\/v1\/600\/album-cover-id\?v=0&s=[a-f0-9]{32}$/,
  );
  expect(image).not.toHaveClass("invisible");
  expect(image).toHaveAttribute("decoding", "async");
  expect(image).toHaveAttribute("data-cover-art-pending");
  expect(image).not.toHaveAttribute("data-cover-art-reveal");
  expect(
    artwork?.querySelector("[data-favorite-artwork-fallback]"),
  ).not.toBeInTheDocument();

  if (!image) throw new Error("Expected local Favorite artwork.");
  fireEvent.load(image);
  expect(image).not.toHaveAttribute("data-cover-art-pending");
  expect(image).toHaveAttribute("data-cover-art-reveal");
  fireEvent.animationEnd(image);
  expect(image).not.toHaveAttribute("data-cover-art-reveal");
});

it("shares painted local sources across collection and Favorite remounts", () => {
  const sourceAlbum = favoriteCollection().albums[0];
  const primer = render(<CoverArt album={sourceAlbum} size="small" />);
  const primerImage = screen.getByRole("img", { name: "Mirage cover" });
  fireEvent.load(primerImage);
  primer.unmount();

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(testTree(queryClient, favoriteCollection()));

  const image = screen
    .getByRole("link", { name: "Open Mirage" })
    .querySelector("img");
  expect(image).toHaveAttribute("loading", "eager");
  expect(image).toHaveAttribute("decoding", "sync");
  expect(image).not.toHaveAttribute("data-cover-art-pending");
  expect(image).not.toHaveAttribute("data-cover-art-reveal");
});

it("invalidates failed Favorite artwork once, then falls back without a loop", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    testTree(queryClient, favoriteCollection(directArtworkUrl)),
  );
  const releaseLink = screen.getByRole("link", { name: "Open Mirage" });
  let artwork = releaseLink.querySelector<HTMLElement>("[data-slot=cover]");
  const directImage = artwork?.querySelector("img");
  const initialSource = directImage?.getAttribute("src");
  expect(initialSource).toMatch(
    /^coda-cover:\/v1\/600\/album-cover-id\?v=0&s=[a-f0-9]{32}$/,
  );
  if (!directImage) throw new Error("Expected local Favorite artwork.");

  fireEvent.error(directImage);

  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledOnce());
  expect(mocks.invoke).toHaveBeenCalledWith("invalidate_cover_art", {
    coverArtId: "album-cover-id",
  });
  artwork = screen
    .getByRole("link", { name: "Open Mirage" })
    .querySelector<HTMLElement>("[data-slot=cover]");
  const retriedImage = artwork?.querySelector("img");
  expect(retriedImage).toHaveAttribute(
    "src",
    expect.stringMatching(
      /^coda-cover:\/v1\/600\/album-cover-id\?v=retry-\d+&s=[a-f0-9]{32}$/,
    ),
  );
  expect(retriedImage).not.toHaveClass("invisible");
  expect(retriedImage).toHaveAttribute("data-cover-art-pending");
  expect(
    artwork?.querySelector("[data-favorite-artwork-fallback]"),
  ).not.toBeInTheDocument();
  if (!retriedImage) throw new Error("Expected retried Favorite artwork.");

  fireEvent.error(retriedImage);

  expect(artwork?.querySelector("img")).not.toBeInTheDocument();
  expect(mocks.invoke).toHaveBeenCalledOnce();
  expect(
    artwork?.querySelector("[data-favorite-artwork-fallback]"),
  ).toBeInTheDocument();

  view.rerender(testTree(queryClient, favoriteCollection(laterArtworkUrl)));
  artwork = screen
    .getByRole("link", { name: "Open Mirage" })
    .querySelector<HTMLElement>("[data-slot=cover]");
  expect(artwork?.querySelector("img")).not.toBeInTheDocument();
  expect(
    view.container.querySelector("a a, a button, button a"),
  ).not.toBeInTheDocument();

  act(() => clearCoverArtRendererState());
  await waitFor(() =>
    expect(artwork?.querySelector("img")?.getAttribute("src")).toMatch(
      /^coda-cover:\/v1\/600\/album-cover-id\?v=0&s=[a-f0-9]{32}$/,
    ),
  );
  expect(artwork?.querySelector("img")?.getAttribute("src")).not.toBe(
    initialSource,
  );
});
