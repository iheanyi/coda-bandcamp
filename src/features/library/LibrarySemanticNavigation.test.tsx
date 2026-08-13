import { QueryClient } from "@tanstack/react-query";
import { RouterContextProvider } from "@tanstack/react-router";
import { createRef, type ComponentProps, type ReactElement } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ArtistGroup } from "@/libraryBrowse";
import { createCodaMemoryRouter, type CodaRouter } from "@/router";
import type { Album, Track } from "@/types";
import { AlbumCard } from "./AlbumCard";
import { AlbumDetailPage } from "./AlbumDetailPage";
import { ArtistCard } from "./ArtistCard";
import { ReleaseResults } from "./LibraryResults";
import { RecentScreen } from "./RecentScreen";

const guestTrack: Track = {
  id: "track-1",
  title: "Glass Lines",
  artist: "Guest Voice",
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
  tracks: [guestTrack],
  palette: ["#777", "#222"],
};

const artist: ArtistGroup = {
  key: "signal garden",
  name: "Signal Garden",
  albums: [album],
  releaseCount: 1,
  trackCount: 1,
  duration: 201,
  representative: album,
};

const initialLocation =
  "/collection?q=Signal&genre=Ambient&sort=artist&mode=releases";

async function renderWithRouter(view: ReactElement) {
  const router = createCodaMemoryRouter(
    new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    [initialLocation],
  );
  await router.load();
  const rendered = render(
    <RouterContextProvider router={router}>{view}</RouterContextProvider>,
  );
  return { ...rendered, router };
}

function linkLocation(link: HTMLElement) {
  const href = link.getAttribute("href");
  expect(href).not.toBeNull();
  return new URL(href ?? "", "https://coda.local");
}

function expectNoNestedInteractiveElements(container: HTMLElement) {
  expect(
    container.querySelector(
      "a a, a button, a input, a select, a textarea, button a",
    ),
  ).not.toBeInTheDocument();
}

function albumCardProps(
  overrides: Partial<ComponentProps<typeof AlbumCard>> = {},
): ComponentProps<typeof AlbumCard> {
  return {
    active: false,
    album,
    loading: false,
    onArtist: vi.fn(),
    onOpen: vi.fn(),
    onPlay: vi.fn(),
    onQueue: vi.fn(),
    onTogglePlayback: vi.fn(),
    playing: false,
    ...overrides,
  };
}

describe("library semantic navigation", () => {
  it("gives album artwork and titles typed hrefs while playback remains an action", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onPlay = vi.fn();
    const { container, router } = await renderWithRouter(
      <AlbumCard {...albumCardProps({ onOpen, onPlay })} />,
    );

    const artworkLink = screen.getByRole("link", { name: "Open Blue Hours" });
    const titleLink = screen.getByRole("link", { name: "Blue Hours" });
    const albumLocation = linkLocation(artworkLink);

    expect(albumLocation.pathname).toBe("/collection/albums/album-1");
    expect(Object.fromEntries(albumLocation.searchParams)).toEqual({
      genre: "Ambient",
      mode: "releases",
      q: "Signal",
      sort: "artist",
    });
    expect(titleLink).toHaveAttribute("href", artworkLink.getAttribute("href"));

    titleLink.focus();
    await user.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledWith(album, titleLink);
    expect(onPlay).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe("/collection");

    await user.click(screen.getByRole("button", { name: "Play Blue Hours" }));
    expect(onPlay).toHaveBeenCalledWith(album);
    expect(onOpen).toHaveBeenCalledOnce();
    expect(
      (await screen.findByRole("button", { name: "Play Blue Hours" })).closest(
        '[data-slot="card-action-overlay"]',
      ),
    ).toBeInTheDocument();
    expectNoNestedInteractiveElements(container);
  });

  it("uses a canonical artist link and delegates activation to the transition callback", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const { container } = await renderWithRouter(
      <ArtistCard group={artist} onOpen={onOpen} />,
    );
    const link = screen.getByRole("link", { name: "Browse Signal Garden" });
    const destination = linkLocation(link);

    expect(destination.pathname).toBe("/collection/artists/signal%20garden");
    expect(Object.fromEntries(destination.searchParams)).toEqual({
      genre: "Ambient",
      mode: "artists",
      q: "Signal",
      sort: "artist",
    });

    link.focus();
    await user.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledWith(artist, link);
    expectNoNestedInteractiveElements(container);
  });

  it("adds a validated source album only for a track credited to another artist", async () => {
    const onArtist = vi.fn();
    const onPlayTrack = vi.fn();
    const { container } = await renderWithRouter(
      <AlbumDetailPage
        album={album}
        currentAlbumId={undefined}
        currentTrackId={undefined}
        favoriteAlbum={false}
        favoriteTrackIds={new Set<string>()}
        loading={false}
        onAddToPlaylist={vi.fn()}
        onArtist={onArtist}
        onBack={vi.fn()}
        onPlayAlbum={vi.fn()}
        onPlayTrack={onPlayTrack}
        onQueueAlbum={vi.fn()}
        onQueueTrack={vi.fn()}
        onToggleFavoriteAlbum={vi.fn()}
        onToggleFavoriteTrack={vi.fn()}
        onTogglePlayback={vi.fn()}
        playing={false}
      />,
    );

    const albumArtistLink = screen.getByRole("link", {
      name: "Signal Garden",
    });
    const guestArtistLink = await screen.findByRole("link", {
      name: "Guest Voice",
    });
    const albumArtistDestination = linkLocation(albumArtistLink);
    const guestArtistDestination = linkLocation(guestArtistLink);

    expect(albumArtistDestination.searchParams.has("albumId")).toBe(false);
    expect(
      Object.fromEntries(albumArtistDestination.searchParams),
    ).toMatchObject({
      genre: "All",
      mode: "artists",
      q: "",
    });
    expect(guestArtistDestination.pathname).toBe(
      "/collection/artists/guest%20voice",
    );
    expect(guestArtistDestination.searchParams.get("albumId")).toBe("album-1");

    await userEvent.click(guestArtistLink);
    expect(onArtist).toHaveBeenCalledWith(
      guestTrack.artist,
      guestTrack.albumId,
      guestTrack,
      guestArtistLink,
    );
    expect(onPlayTrack).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Play Glass Lines" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Play Glass Lines" }),
    ).toHaveAttribute("data-slot", "row-playback-action");
    expect(
      screen.getByRole("button", { name: "Add Glass Lines to queue" })
        .parentElement,
    ).toHaveAttribute("data-slot", "row-action-group");
    expectNoNestedInteractiveElements(container);
  });

  it("routes Recently Added releases through the shared AlbumCard choreography", async () => {
    await renderWithRouter(
      <RecentScreen
        actions={{
          availability: {
            onConnect: vi.fn(),
            onRetryStartup: vi.fn(),
            onSync: vi.fn(),
          },
          releases: {
            onArtist: vi.fn(),
            onClearFilters: vi.fn(),
            onOpen: vi.fn(),
            onPlay: vi.fn(),
            onQueue: vi.fn(),
            onQueueSearchResults: vi.fn(),
            onTogglePlayback: vi.fn(),
          },
        }}
        model={{
          availability: {
            connected: true,
            isInitialLoading: false,
            libraryError: "",
            releaseCount: 1,
            syncState: "idle",
          },
          results: {
            albums: [album],
            browseMode: "releases",
            hasActiveFilters: false,
            hasSearchQuery: false,
            playing: false,
            title: "Recently added",
          },
        }}
        refs={{ libraryPane: createRef<HTMLElement>() }}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "Recently added" }),
    ).toBeInTheDocument();
    expect(
      (await screen.findByRole("button", { name: "Play Blue Hours" })).closest(
        '[data-slot="card-action-overlay"]',
      ),
    ).toBeInTheDocument();
  });

  it("uses safe router intent preload without a custom metadata prefetch handler", async () => {
    const router = createCodaMemoryRouter(
      new QueryClient({ defaultOptions: { queries: { retry: false } } }),
      [initialLocation],
    );
    await router.load();
    const preloadRoute = vi.spyOn(router, "preloadRoute");

    render(
      <RouterContextProvider router={router}>
        <ReleaseResults
          actions={{
            onArtist: vi.fn(),
            onClearFilters: vi.fn(),
            onOpen: vi.fn(),
            onPlay: vi.fn(),
            onQueue: vi.fn(),
            onQueueSearchResults: vi.fn(),
            onTogglePlayback: vi.fn(),
          }}
          model={{
            albums: [album],
            browseMode: "releases",
            hasActiveFilters: false,
            hasSearchQuery: false,
            playing: false,
            title: "All releases",
          }}
          scrollElementRef={createRef<HTMLElement>()}
        />
      </RouterContextProvider>,
    );

    const albumLink = await screen.findByRole("link", { name: "Blue Hours" });
    fireEvent.focus(albumLink);

    await waitFor(() => expect(preloadRoute).toHaveBeenCalledOnce());
    expect(router.options.defaultPreload).toBe("intent");
    expect(router.state.location.pathname).toBe("/collection");
  });

  it("does not run a duplicate preload on pointer-down before activation", async () => {
    const router = createCodaMemoryRouter(
      new QueryClient({ defaultOptions: { queries: { retry: false } } }),
      [initialLocation],
    );
    await router.load();
    const preloadRoute = vi.spyOn(router, "preloadRoute");
    const onOpen = vi.fn();

    render(
      <RouterContextProvider router={router}>
        <ReleaseResults
          actions={{
            onArtist: vi.fn(),
            onClearFilters: vi.fn(),
            onOpen,
            onPlay: vi.fn(),
            onQueue: vi.fn(),
            onQueueSearchResults: vi.fn(),
            onTogglePlayback: vi.fn(),
          }}
          model={{
            albums: [album],
            browseMode: "releases",
            hasActiveFilters: false,
            hasSearchQuery: false,
            playing: false,
            title: "All releases",
          }}
          scrollElementRef={createRef<HTMLElement>()}
        />
      </RouterContextProvider>,
    );

    const albumLink = await screen.findByRole("link", {
      name: "Open Blue Hours",
    });
    fireEvent.pointerDown(albumLink, { button: 0, isPrimary: true });
    fireEvent.click(albumLink);

    expect(preloadRoute).not.toHaveBeenCalled();
    expect(onOpen).toHaveBeenCalledOnce();
    expect(router.state.location.pathname).toBe("/collection");
  });
});
