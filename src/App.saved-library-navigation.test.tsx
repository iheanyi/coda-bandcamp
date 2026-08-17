import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { albumQueryKey } from "./libraryQueries";
import {
  emptyLocalFavorites,
  LOCAL_FAVORITES_KEY,
  writeLocalFavorites,
} from "./localFavorites";
import {
  album,
  albumFavorites,
  deferred,
  getNavigationSlotLink,
  mocks,
  renderApp,
  trackFavorites,
  tracks,
} from "./test/appTestHarness";
import type { FavoriteCollection } from "./types";

describe("App saved-library navigation", () => {
  it("does not mutate Bandcamp Favorites before their initial hydration", async () => {
    const favoritesRequest = deferred<FavoriteCollection>();
    mocks.fetchFavorites.mockReturnValueOnce(favoritesRequest.promise);
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    renderApp();

    await screen.findByText("Soft Focus");
    fireEvent.click(screen.getByRole("link", { name: "Open Soft Focus" }));
    const albumPage = await screen.findByRole("article", {
      name: "Soft Focus release details",
    });
    fireEvent.click(within(albumPage).getByRole("button", { name: "Favorite" }));

    expect(mocks.setFavorite).not.toHaveBeenCalled();
    expect((await screen.findAllByText(
      "Favorites are still loading. Try again in a moment.",
    )).length).toBeGreaterThan(0);

    await act(async () => favoritesRequest.resolve(albumFavorites));

    expect(await within(albumPage).findByRole("button", {
      name: "Favorited",
    })).toHaveAttribute("aria-pressed", "true");
    expect(mocks.setFavorite).not.toHaveBeenCalled();
  });

  it("syncs music favorites with Bandcamp and opens their internal release page", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    mocks.fetchFavorites
      .mockResolvedValueOnce({ albumIds: [], songIds: [], albums: [], tracks: [] })
      .mockResolvedValue(albumFavorites);
    renderApp();

    await screen.findByText("Soft Focus");
    fireEvent.click(screen.getByRole("link", { name: "Open Soft Focus" }));
    const albumPage = await screen.findByRole("article", {
      name: "Soft Focus release details",
    });
    fireEvent.click(within(albumPage).getByRole("button", { name: "Favorite" }));

    await waitFor(() => expect(mocks.setFavorite).toHaveBeenCalledWith({
      id: album.id,
      kind: "album",
      favorite: true,
    }));
    expect(window.localStorage.getItem(LOCAL_FAVORITES_KEY)).toBeNull();

    fireEvent.click(screen.getByRole("link", { name: "Favorites" }));
    expect(await screen.findByText(
      "Music favorites sync through Bandcamp’s Subsonic service, separate from the Bandcamp website. Track listings can lag, so Coda confirms them as albums load and on Refresh. Radio shows stay on this device.",
    )).toBeInTheDocument();
    expect(screen.getByText("Soft Focus")).toBeInTheDocument();
    const favoriteAlbumTrigger = screen.getByRole("link", {
      name: "Soft Focus",
    });
    favoriteAlbumTrigger.focus();
    fireEvent.click(favoriteAlbumTrigger);
    const reopenedAlbum = await screen.findByRole("article", {
      name: "Soft Focus release details",
    });
    expect(within(reopenedAlbum).getByText("First Light")).toBeInTheDocument();

    fireEvent.click(within(reopenedAlbum).getByRole("button", {
      name: "Back",
    }));

    expect(await screen.findByText(
      "Music favorites sync through Bandcamp’s Subsonic service, separate from the Bandcamp website. Track listings can lag, so Coda confirms them as albums load and on Refresh. Radio shows stay on this device.",
    )).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Soft Focus" }))
        .toHaveFocus(),
    );
  });

  it("rolls back an optimistic Favorite and withholds success when Bandcamp rejects it", async () => {
    const writeRequest = deferred<void>();
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    mocks.setFavorite.mockReturnValueOnce(writeRequest.promise);
    renderApp();

    await screen.findByText("Soft Focus");
    fireEvent.click(screen.getByRole("link", { name: "Open Soft Focus" }));
    const albumPage = await screen.findByRole("article", {
      name: "Soft Focus release details",
    });
    fireEvent.click(within(albumPage).getByRole("button", { name: "Favorite" }));

    expect(await within(albumPage).findByRole("button", { name: "Favorited" }))
      .toHaveAttribute("aria-pressed", "true");
    await act(async () => {
      writeRequest.reject(new Error("Bandcamp Favorites could not be saved."));
    });
    expect((await screen.findAllByText(
      "Bandcamp Favorites could not be saved.",
    )).length).toBeGreaterThan(0);
    expect(await within(albumPage).findByRole("button", { name: "Favorite" }))
      .toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText("Saved to Bandcamp Subsonic Favorites"))
      .not.toBeInTheDocument();
  });

  it("reuses favorite release artwork and title for a warm album detail", async () => {
    const coveredAlbum = {
      ...album,
      coverArt: "cover-soft-focus",
    };
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([coveredAlbum]);
    mocks.fetchFavorites.mockResolvedValue({
      ...albumFavorites,
      albums: [coveredAlbum],
    });
    const { queryClient } = renderApp();
    queryClient.setQueryData(albumQueryKey(coveredAlbum.id), tracks);

    await screen.findByText("Soft Focus");
    fireEvent.click(screen.getByRole("link", { name: "Favorites" }));
    await screen.findByText(
      "Music favorites sync through Bandcamp’s Subsonic service, separate from the Bandcamp website. Track listings can lag, so Coda confirms them as albums load and on Refresh. Radio shows stay on this device.",
    );
    await waitFor(() =>
      expect(
        document.querySelector(
          '[data-album-card="album-1"] [data-slot="cover"]',
        ),
      ).toBeInTheDocument()
    );

    const snapshots: Array<{
      className: string;
      artworkSourceBeforeUpdate: number;
      titleSourceBeforeUpdate: number;
      artworkDetailAfterUpdate: number;
      titleDetailAfterUpdate: number;
    }> = [];
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "startViewTransition",
    );
    const startViewTransition = vi.fn((update: () => void | Promise<void>) => {
      const artworkSourceBeforeUpdate = document.querySelectorAll(
        ".coda-album-artwork-source",
      ).length;
      const titleSourceBeforeUpdate = document.querySelectorAll(
        "[data-coda-album-title-source]",
      ).length;
      const finished = Promise.resolve(update()).then(() => {
        snapshots.push({
          className: document.documentElement.className,
          artworkSourceBeforeUpdate,
          titleSourceBeforeUpdate,
          artworkDetailAfterUpdate: document.querySelectorAll(
            ".album-detail__artwork [data-slot='cover']",
          ).length,
          titleDetailAfterUpdate: document.querySelectorAll(
            "[data-coda-album-title-detail]",
          ).length,
        });
      });
      return { finished };
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    try {
      fireEvent.click(screen.getByRole("link", {
        name: "Soft Focus",
      }));

      expect(startViewTransition).toHaveBeenCalledOnce();
      await waitFor(() => expect(snapshots).toEqual([{
        className: expect.stringContaining(
          "coda-transition--album-detail",
        ),
        artworkSourceBeforeUpdate: 1,
        titleSourceBeforeUpdate: 1,
        artworkDetailAfterUpdate: 1,
        titleDetailAfterUpdate: 1,
      }]));
      const albumPage = await screen.findByRole("article", {
        name: "Soft Focus release details",
      });
      fireEvent.click(within(albumPage).getByRole("button", {
        name: "Back",
      }));

      expect(startViewTransition).toHaveBeenCalledTimes(2);
    } finally {
      document.documentElement.classList.remove(
        "coda-transition--album-detail",
      );
      if (originalDescriptor) {
        Object.defineProperty(
          document,
          "startViewTransition",
          originalDescriptor,
        );
      } else {
        Reflect.deleteProperty(document, "startViewTransition");
      }
    }
  });

  it("restores the exact favorite-track album link after album Back", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    mocks.fetchFavorites.mockResolvedValue(trackFavorites);
    renderApp();

    await screen.findByText("Soft Focus");
    fireEvent.click(screen.getByRole("link", { name: "Favorites" }));
    await screen.findByText(
      "Music favorites sync through Bandcamp’s Subsonic service, separate from the Bandcamp website. Track listings can lag, so Coda confirms them as albums load and on Refresh. Radio shows stay on this device.",
    );

    const favoriteTrackAlbumLink = getNavigationSlotLink(
      "Open Soft Focus album",
      "favorite-track:track-1",
    );
    favoriteTrackAlbumLink.focus();
    fireEvent.click(favoriteTrackAlbumLink);

    const albumPage = await screen.findByRole("article", {
      name: "Soft Focus release details",
    });
    const transitionFinished = deferred<void>();
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "startViewTransition",
    );
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: vi.fn((update: () => void | Promise<void>) => {
        update();
        return { finished: transitionFinished.promise };
      }),
    });

    try {
      fireEvent.click(within(albumPage).getByRole("button", {
        name: "Back",
      }));

      await screen.findByText(
        "Music favorites sync through Bandcamp’s Subsonic service, separate from the Bandcamp website. Track listings can lag, so Coda confirms them as albums load and on Refresh. Radio shows stay on this device.",
      );

      await act(async () => transitionFinished.resolve());
      await waitFor(() =>
        expect(getNavigationSlotLink(
          "Open Soft Focus album",
          "favorite-track:track-1",
        )).toHaveFocus(),
      );
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(
          document,
          "startViewTransition",
          originalDescriptor,
        );
      } else {
        Reflect.deleteProperty(document, "startViewTransition");
      }
    }
  });

  it("renders the persisted Bandcamp track-star index after restart and opens Now Playing", async () => {
    const indexedTrack = {
      ...tracks[0],
      starredAt: "2026-08-12T18:01:00Z",
    };
    writeLocalFavorites({
      ...emptyLocalFavorites(),
      songIds: [indexedTrack.id],
      tracks: [indexedTrack],
    });
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    mocks.fetchFavorites.mockResolvedValue({
      albumIds: [],
      songIds: [],
      albums: [],
      tracks: [],
    });
    renderApp();

    await screen.findByText("Soft Focus");
    fireEvent.click(screen.getByRole("link", { name: "Favorites" }));
    const favoriteTracks = await screen.findByLabelText("Favorite tracks");
    fireEvent.click(within(favoriteTracks).getByRole("button", {
      name: "Play First Light",
    }));

    const nowPlayingLink = await screen.findByRole("link", {
      name: "Open Now Playing",
    });
    fireEvent.click(nowPlayingLink);

    expect(await screen.findByRole("article", { name: "First Light" }))
      .toBeInTheDocument();
  });

  it("shares a favorite track album title when artwork is unavailable", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    mocks.fetchFavorites.mockResolvedValue(trackFavorites);
    const { queryClient } = renderApp();

    await screen.findByText("Soft Focus");
    queryClient.setQueryData(albumQueryKey(album.id), tracks);
    fireEvent.click(screen.getByRole("link", { name: "Favorites" }));
    await screen.findByText(
      "Music favorites sync through Bandcamp’s Subsonic service, separate from the Bandcamp website. Track listings can lag, so Coda confirms them as albums load and on Refresh. Radio shows stay on this device.",
    );
    const albumLink = getNavigationSlotLink(
      "Open Soft Focus album",
      "favorite-track:track-1",
    );
    const snapshots: Array<{
      className: string;
      artworkSourceBeforeUpdate: number;
      titleSourceBeforeUpdate: number;
      titleDetailAfterUpdate: number;
    }> = [];
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "startViewTransition",
    );
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: vi.fn((update: () => void) => {
        const artworkSourceBeforeUpdate = document.querySelectorAll(
          ".coda-album-artwork-source",
        ).length;
        const titleSourceBeforeUpdate = document.querySelectorAll(
          "[data-coda-album-title-source]",
        ).length;
        const finished = Promise.resolve(update()).then(() => {
          snapshots.push({
            className: document.documentElement.className,
            artworkSourceBeforeUpdate,
            titleSourceBeforeUpdate,
            titleDetailAfterUpdate: document.querySelectorAll(
              "[data-coda-album-title-detail]",
            ).length,
          });
        });
        return { finished };
      }),
    });

    try {
      fireEvent.click(albumLink);

      await waitFor(() => expect(snapshots).toEqual([{
        className: expect.stringContaining(
          "coda-transition--album-detail",
        ),
        artworkSourceBeforeUpdate: 1,
        titleSourceBeforeUpdate: 1,
        titleDetailAfterUpdate: 1,
      }]));
      expect(await screen.findByRole("article", {
        name: "Soft Focus release details",
      })).toBeInTheDocument();
    } finally {
      document.documentElement.classList.remove(
        "coda-transition--album-detail",
      );
      if (originalDescriptor) {
        Object.defineProperty(
          document,
          "startViewTransition",
          originalDescriptor,
        );
      } else {
        Reflect.deleteProperty(document, "startViewTransition");
      }
    }
  });

  it("opens a favorite Radio detail through a non-shared page transition", async () => {
    window.localStorage.setItem(
      "coda.local-favorites.v1",
      JSON.stringify({
        version: 2,
        albumIds: [],
        songIds: [],
        albums: [],
        tracks: [],
        radioShowIds: [979],
        radioShows: [{
          id: 979,
          subtitle: "The Coda Broadcast",
          title: "Bandcamp Weekly",
          description: "A broadcast from Bandcamp.",
          publishedAt: "2026-07-20T12:00:00Z",
        }],
      }),
    );
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "startViewTransition",
    );
    const startViewTransition = vi.fn((update: () => void | Promise<void>) => {
      const finished = Promise.resolve(update());
      return { finished };
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    try {
      renderApp();

      await screen.findByText("Soft Focus");
      fireEvent.click(screen.getByRole("link", { name: "Favorites" }));
      await screen.findByText(
        "Music favorites sync through Bandcamp’s Subsonic service, separate from the Bandcamp website. Track listings can lag, so Coda confirms them as albums load and on Refresh. Radio shows stay on this device.",
      );
      startViewTransition.mockClear();

      fireEvent.click(screen.getByRole("link", {
        name: "Open The Coda Broadcast details",
      }));

      expect(await screen.findByRole("heading", {
        name: "Songs in this show",
      })).toBeInTheDocument();
      expect(startViewTransition).not.toHaveBeenCalled();
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(
          document,
          "startViewTransition",
          originalDescriptor,
        );
      } else {
        Reflect.deleteProperty(document, "startViewTransition");
      }
    }
  });

  it("renders a favorite album tracklist when its detail transition applies late", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    mocks.fetchFavorites.mockResolvedValue(albumFavorites);
    const { queryClient } = renderApp();
    queryClient.setQueryData(albumQueryKey(album.id), tracks);

    await screen.findByText("Soft Focus");
    fireEvent.click(screen.getByRole("link", { name: "Favorites" }));
    await screen.findByText(
      "Music favorites sync through Bandcamp’s Subsonic service, separate from the Bandcamp website. Track listings can lag, so Coda confirms them as albums load and on Refresh. Radio shows stay on this device.",
    );

    mocks.fetchAlbum.mockClear();
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "startViewTransition",
    );
    let applyTransitionUpdate: (() => void) | undefined;
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: vi.fn((update: () => void) => {
        applyTransitionUpdate = update;
        return { finished: Promise.resolve() };
      }),
    });

    try {
      fireEvent.click(screen.getByRole("link", { name: "Soft Focus" }));
      applyTransitionUpdate?.();

      const albumPage = await screen.findByRole("article", {
        name: "Soft Focus release details",
      });
      expect(within(albumPage).getByText("First Light")).toBeInTheDocument();
      expect(within(albumPage).queryByText("Loading tracks…"))
        .not.toBeInTheDocument();
      expect(within(albumPage).getByText("Afterimage")).toBeInTheDocument();
      expect(mocks.fetchAlbum).not.toHaveBeenCalled();
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(
          document,
          "startViewTransition",
          originalDescriptor,
        );
      } else {
        Reflect.deleteProperty(document, "startViewTransition");
      }
    }
  });
});
