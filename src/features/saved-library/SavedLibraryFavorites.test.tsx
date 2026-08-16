import {
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { LocalFavoriteCollection, Track } from "@/types";
import {
  commonProps,
  favorites,
  mocks,
  renderSavedLibraryRoute,
  resizeObserverEntry,
  track,
} from "@/test/savedLibraryViewTestHarness";

describe("saved favorites", () => {
  it("renders Favorites through its file route and runtime provider", async () => {
    const { router } = renderSavedLibraryRoute();

    expect(
      await screen.findByRole("heading", { name: "Favorites" }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/favorites");
    expect(mocks.fetchPlaylists).not.toHaveBeenCalled();
  });

  it("distinguishes synced music stars from device-local Radio favorites", async () => {
    renderSavedLibraryRoute({
      runtime: { ...commonProps, favoritesLocal: false },
    });

    expect(
      await screen.findByText(
        "Music favorites sync through Bandcamp’s Subsonic service, separate from the Bandcamp website. Track listings can lag, so Coda confirms them as albums load and on Refresh. Radio shows stay on this device.",
      ),
    ).toBeInTheDocument();
  });

  it("renders favorites and removes a starred track through the supplied action", async () => {
    renderSavedLibraryRoute();

    const favoriteTracks = await screen.findByLabelText("Favorite tracks");
    expect(
      within(favoriteTracks).getByRole("button", { name: "Play Mirage" }),
    ).toHaveAttribute("data-slot", "row-playback-action");
    expect(
      within(favoriteTracks).getByRole("button", {
        name: "Add Mirage to queue",
      }).parentElement,
    ).toHaveAttribute("data-slot", "row-action-group");
    fireEvent.click(
      within(favoriteTracks).getByRole("button", {
        name: "Remove Mirage from favorites",
      }),
    );
    expect(commonProps.onToggleFavorite).toHaveBeenCalledWith(
      "song-1",
      "song",
      false,
    );
    fireEvent.click(
      within(favoriteTracks).getByRole("link", { name: "Sweeps" }),
    );
    expect(commonProps.onOpenArtist).toHaveBeenCalledWith(
      "Sweeps",
      "album-1",
      track,
      expect.any(HTMLElement),
    );
    const favoriteAlbumButton = within(favoriteTracks)
      .getAllByRole("link", { name: "Open Mirage album" })
      .find((link) => link.hasAttribute("data-coda-album-title-target"));
    if (!favoriteAlbumButton) throw new Error("Expected favorite album link");
    expect(favoriteAlbumButton).toHaveAttribute(
      "data-coda-album-title-target",
      "album-1",
    );
    expect(favoriteAlbumButton.closest("[data-album-card]")).toHaveAttribute(
      "data-album-card",
      "album-1",
    );
    fireEvent.click(favoriteAlbumButton);
    expect(commonProps.onOpenTrackAlbum).toHaveBeenCalledWith(
      track,
      favoriteAlbumButton,
    );
    fireEvent.click(
      screen.getByRole("link", {
        name: "Browse The Hip Hop Show",
      }),
    );
    expect(commonProps.onOpenRadioSeries).toHaveBeenCalledWith(5);
    expect(
      screen.getByRole("button", { name: "Play The Hip Hop Show" }),
    ).toHaveTextContent("Play");
    const radioSeriesLink = screen.getByRole("link", {
      name: "Browse The Hip Hop Show",
    });
    expect(
      radioSeriesLink.parentElement?.querySelector("time"),
    ).toHaveAttribute("dateTime", favorites.radioShows[0].publishedAt);
    expect(
      document.querySelector('[data-radio-show-artwork="979"] img'),
    ).toHaveAttribute("src", favorites.radioShows[0].artworkUrl);
    expect(
      screen.queryByText(favorites.radioShows[0].description ?? ""),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("link", {
        name: "Open The Hip Hop Show details",
      }),
    );
    expect(commonProps.onOpenRadioShow).toHaveBeenCalledWith(
      favorites.radioShows[0],
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove The Hip Hop Show from favorites",
      }),
    );
    expect(commonProps.onToggleRadioFavorite).toHaveBeenCalledWith(
      favorites.radioShows[0],
      false,
    );
    const favoriteReleases = screen
      .getByRole("heading", {
        name: "Releases",
      })
      .closest("section");
    if (!favoriteReleases) throw new Error("Expected favorite releases");
    const favoriteReleaseTitle = within(favoriteReleases).getByRole("link", {
      name: "Mirage",
    });
    expect(favoriteReleaseTitle).toHaveAttribute(
      "data-coda-album-title-target",
      "album-1",
    );
    expect(favoriteReleaseTitle.closest("[data-album-card]")).toHaveAttribute(
      "data-album-card",
      "album-1",
    );
  });

  it("exposes typed saved destinations without nesting actions or starting playback", async () => {
    const user = userEvent.setup();
    const { container, router } = renderSavedLibraryRoute();

    const favoriteTracks = await screen.findByLabelText("Favorite tracks");
    const trackArtist = within(favoriteTracks).getByRole("link", {
      name: "Sweeps",
    });
    const trackAlbum = within(favoriteTracks)
      .getAllByRole("link", { name: "Open Mirage album" })
      .find((link) => link.hasAttribute("data-coda-album-title-target"));
    if (!trackAlbum) throw new Error("Expected favorite track album link");
    expect(trackArtist).toHaveAttribute(
      "href",
      "/collection/artists/sweeps?q=&genre=All&sort=recent&mode=artists&albumId=album-1",
    );
    expect(trackAlbum).toHaveAttribute(
      "href",
      "/collection/albums/album-1?q=&genre=All&sort=recent&mode=releases",
    );

    const releases = screen
      .getByRole("heading", { name: "Releases" })
      .closest("section");
    if (!releases) throw new Error("Expected favorite releases");
    expect(
      within(releases).getByRole("link", { name: "Open Mirage" }),
    ).toHaveAttribute("href", trackAlbum.getAttribute("href"));
    expect(
      within(releases).getByRole("link", { name: "Mirage" }),
    ).toHaveAttribute("href", trackAlbum.getAttribute("href"));
    expect(
      within(releases).getByRole("link", { name: "Sweeps" }),
    ).toHaveAttribute("href", trackArtist.getAttribute("href"));

    const radioShow = screen.getByRole("link", {
      name: "Open The Hip Hop Show details",
    });
    expect(radioShow).toHaveAttribute("href", "/radio/shows/979");
    expect(
      screen.getByRole("link", {
        name: "Open The Hip Hop Show episode",
      }),
    ).toHaveAttribute("href", "/radio/shows/979");
    expect(
      screen.getByRole("link", {
        name: "Browse The Hip Hop Show",
      }),
    ).toHaveAttribute("href", "/radio/series/5");

    expect(container.querySelector("a button, button a, a a")).toBeNull();

    trackAlbum.focus();
    await user.keyboard("{Enter}");
    expect(commonProps.onOpenTrackAlbum).toHaveBeenCalledWith(
      track,
      trackAlbum,
    );
    expect(commonProps.onPlayTrack).not.toHaveBeenCalled();
    expect(commonProps.onPlayTracks).not.toHaveBeenCalled();
    expect(commonProps.onTogglePlayback).not.toHaveBeenCalled();

    const preloadRoute = vi.spyOn(router, "preloadRoute");
    fireEvent.mouseEnter(radioShow);
    await waitFor(() => expect(preloadRoute).toHaveBeenCalled());
    expect(mocks.fetchRadioShow).not.toHaveBeenCalled();
  });

  it("marks every saved-library album destination busy while its album opens", async () => {
    const favoriteView = renderSavedLibraryRoute({
      runtime: { ...commonProps, loadingAlbumId: "album-1" },
    });
    await screen.findByRole("heading", { name: "Favorites" });

    const releases = screen
      .getByRole("heading", { name: "Releases" })
      .closest("section");
    if (!releases) throw new Error("Expected a releases section");
    const artworkButton = within(releases).getByRole("link", {
      name: "Open Mirage",
    });
    const titleButton = within(releases).getByRole("link", {
      name: "Mirage",
    });

    expect(artworkButton).toHaveAttribute("aria-disabled", "true");
    expect(artworkButton).toHaveAttribute("aria-busy", "true");
    expect(
      within(artworkButton).getByRole("status", {
        name: "Loading Mirage artwork",
      }),
    ).toBeInTheDocument();
    expect(titleButton).toHaveAttribute("aria-disabled", "true");
    expect(titleButton).toHaveAttribute("aria-busy", "true");
    expect(
      within(titleButton).getByRole("status", {
        name: "Loading Mirage release",
      }),
    ).toBeInTheDocument();

    const favoriteTracks = screen.getByLabelText("Favorite tracks");
    const favoriteAlbumButton = within(favoriteTracks)
      .getAllByRole("link", { name: "Open Mirage album" })
      .find((link) => link.hasAttribute("data-coda-album-title-target"));
    if (!favoriteAlbumButton) throw new Error("Expected favorite album link");

    expect(favoriteAlbumButton).toHaveAttribute("aria-disabled", "true");
    expect(favoriteAlbumButton).toHaveAttribute("aria-busy", "true");
    expect(
      within(favoriteAlbumButton).getByRole("status", {
        name: "Loading Mirage album",
      }),
    ).toBeInTheDocument();
    favoriteView.unmount();

    renderSavedLibraryRoute({
      initialEntry: "/playlists",
      runtime: { ...commonProps, loadingAlbumId: "album-1" },
    });

    fireEvent.click(await screen.findByRole("link", { name: /Night drive/ }));
    const playlistTracks = await screen.findByLabelText("Night drive tracks");
    const playlistAlbumButton = within(playlistTracks)
      .getAllByRole("link", { name: "Open Mirage album" })
      .find(
        (link) =>
          link.getAttribute("data-navigation-slot") === "playlist-track:song-1",
      );
    if (!playlistAlbumButton) throw new Error("Expected playlist album link");

    expect(playlistAlbumButton).toHaveAttribute("aria-disabled", "true");
    expect(playlistAlbumButton).toHaveAttribute("aria-busy", "true");
    expect(
      within(playlistAlbumButton).getByRole("status", {
        name: "Loading Mirage album",
      }),
    ).toBeInTheDocument();
  });

  it("keeps a large favorites list bounded while preserving current-track controls", async () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    const originalResizeObserver = globalThis.ResizeObserver;
    class ResizeObserverMock implements ResizeObserver {
      private readonly observed = new WeakSet<Element>();
      constructor(private readonly callback: ResizeObserverCallback) {}
      disconnect() {}
      observe(target: Element) {
        if (this.observed.has(target)) return;
        this.observed.add(target);
        const bounds = target.getBoundingClientRect();
        this.callback([resizeObserverEntry(target, bounds)], this);
      }
      unobserve() {}
    }
    globalThis.ResizeObserver = ResizeObserverMock;
    HTMLElement.prototype.getBoundingClientRect =
      function getBoundingClientRect() {
        const scrollElement = this.hasAttribute("data-coda-library-scroll");
        const top = scrollElement ? 0 : 90;
        const height = scrollElement ? 240 : 0;
        return {
          bottom: top + height,
          height,
          left: 0,
          right: 800,
          top,
          width: 800,
          x: 0,
          y: top,
          toJSON: () => undefined,
        };
      };

    try {
      const tracks = Array.from({ length: 300 }, (_, index): Track => ({
        ...track,
        id: `favorite-track-${index}`,
        title: `Favorite track ${index}`,
        track: index + 1,
      }));
      const largeFavorites: LocalFavoriteCollection = {
        albumIds: [],
        albums: [],
        radioShowIds: [],
        radioShows: [],
        songIds: tracks.map((item) => item.id),
        tracks,
      };
      const onTogglePlayback = vi.fn();
      renderSavedLibraryRoute({
        runtime: {
          ...commonProps,
          currentTrackId: tracks[0].id,
          favorites: largeFavorites,
          onTogglePlayback,
          playing: true,
        },
      });

      const list = await screen.findByRole("list", {
        name: "Favorite tracks",
      });
      await waitFor(() => {
        const rows = within(list).getAllByRole("listitem");
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.length).toBeLessThan(30);
      });
      const pause = screen.getByRole("button", {
        name: "Pause Favorite track 0",
      });
      expect(pause).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(pause);
      expect(onTogglePlayback).toHaveBeenCalledOnce();
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect;
      globalThis.ResizeObserver = originalResizeObserver;
    }
  });

  it("keeps large favorite release and Radio grids bounded with working visible actions", async () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    const originalResizeObserver = globalThis.ResizeObserver;
    class ResizeObserverMock implements ResizeObserver {
      private readonly observed = new WeakSet<Element>();
      constructor(private readonly callback: ResizeObserverCallback) {}
      disconnect() {}
      observe(target: Element) {
        if (this.observed.has(target)) return;
        this.observed.add(target);
        const bounds = target.getBoundingClientRect();
        this.callback([resizeObserverEntry(target, bounds)], this);
      }
      unobserve() {}
    }
    globalThis.ResizeObserver = ResizeObserverMock;
    HTMLElement.prototype.getBoundingClientRect =
      function getBoundingClientRect() {
        const scrollElement = this.hasAttribute("data-coda-library-scroll");
        const top = scrollElement ? 0 : 90;
        const height = scrollElement ? 240 : 0;
        return {
          bottom: top + height,
          height,
          left: 0,
          right: 800,
          top,
          width: 800,
          x: 0,
          y: top,
          toJSON: () => undefined,
        };
      };

    try {
      const albums = Array.from({ length: 5_000 }, (_, index) => ({
        ...favorites.albums[0],
        id: `favorite-album-${index}`,
        title: `Favorite release ${index}`,
      }));
      const radioShows = Array.from({ length: 5_000 }, (_, index) => ({
        ...favorites.radioShows[0],
        id: 10_000 + index,
        subtitle: `Favorite Radio show ${index}`,
      }));
      const largeFavorites: LocalFavoriteCollection = {
        albumIds: albums.map((album) => album.id),
        albums,
        radioShowIds: radioShows.map((show) => show.id),
        radioShows,
        songIds: [],
        tracks: [],
      };
      const onTogglePlayback = vi.fn();
      const onToggleFavorite = vi.fn();
      const onToggleRadioFavorite = vi.fn();
      const onOpenAlbum = vi.fn();
      renderSavedLibraryRoute({
        runtime: {
          ...commonProps,
          currentTrackId: `radio:${radioShows[0].id}`,
          favorites: largeFavorites,
          onOpenAlbum,
          onToggleFavorite,
          onTogglePlayback,
          onToggleRadioFavorite,
          playing: true,
        },
      });

      const radioGrid = await screen.findByRole("list", {
        name: "Favorite radio shows",
      });
      const releaseGrid = await screen.findByRole("list", {
        name: "Favorite releases",
      });
      await waitFor(() => {
        expect(radioGrid).toHaveAttribute("data-virtualized", "true");
        expect(releaseGrid).toHaveAttribute("data-virtualized", "true");
        expect(within(radioGrid).getAllByRole("listitem").length).toBeLessThan(
          50,
        );
        expect(
          within(releaseGrid).getAllByRole("listitem").length,
        ).toBeLessThan(50);
      });
      expect(within(radioGrid).getAllByRole("listitem")[0]).toHaveAttribute(
        "aria-setsize",
        "5000",
      );
      expect(within(releaseGrid).getAllByRole("listitem")[0]).toHaveAttribute(
        "aria-setsize",
        "5000",
      );

      fireEvent.click(
        within(radioGrid).getByRole("button", {
          name: "Pause Favorite Radio show 0",
        }),
      );
      expect(onTogglePlayback).toHaveBeenCalledOnce();
      fireEvent.click(
        within(radioGrid).getByRole("button", {
          name: "Remove Favorite Radio show 0 from favorites",
        }),
      );
      expect(onToggleRadioFavorite).toHaveBeenCalledWith(radioShows[0], false);

      const openRelease = within(releaseGrid).getByRole("link", {
        name: "Open Favorite release 0",
      });
      fireEvent.click(openRelease);
      expect(onOpenAlbum).toHaveBeenCalledWith(albums[0], openRelease);
      fireEvent.click(
        within(releaseGrid).getByRole("button", {
          name: "Remove Favorite release 0 from favorites",
        }),
      );
      expect(onToggleFavorite).toHaveBeenCalledWith(
        albums[0].id,
        "album",
        false,
      );
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect;
      globalThis.ResizeObserver = originalResizeObserver;
    }
  });
});
