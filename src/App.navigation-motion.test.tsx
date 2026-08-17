import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { albumQueryKey } from "./libraryQueries";
import type { Album, Track } from "./types";
import { album, deferred, mocks, renderApp, resizeObserverEntry, tracks } from "./test/appTestHarness";

describe("Coda library navigation and motion flows", () => {

  it("reverse-morphs a cold album into its exact release card on Back", async () => {
    const request = deferred<Track[]>();
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    mocks.fetchAlbum.mockReturnValueOnce(request.promise);
    renderApp();

    await screen.findByText("Soft Focus");
    const libraryPane = screen.getByRole("main");
    libraryPane.scrollTop = 312;
    fireEvent.click(screen.getByRole("link", { name: "Open Soft Focus" }));

    const albumPage = await screen.findByRole("article", {
      name: "Soft Focus release details",
    });
    expect(
      albumPage.querySelector("[data-coda-album-detail-surface]"),
    ).not.toContainElement(
      within(albumPage).getByRole("button", { name: "Back" }),
    );
    expect(libraryPane.scrollTop).toBe(0);

    const originalDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "startViewTransition",
    );
    const transitionClasses: string[] = [];
    const startViewTransition = vi.fn((update: () => void | Promise<void>) => {
      const finished = Promise.resolve(update()).then(() => {
        transitionClasses.push(document.documentElement.className);
      });
      return { finished };
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    try {
      fireEvent.click(within(albumPage).getByRole("button", {
        name: "Back",
      }));

      expect(await screen.findByRole("list", {
        name: "All releases",
      })).toBeInTheDocument();
      expect(startViewTransition).toHaveBeenCalledOnce();
      await waitFor(() => expect(transitionClasses).toEqual([
        expect.stringContaining("coda-transition--album-detail-close"),
      ]));
      expect(libraryPane.scrollTop).toBe(312);

      await act(async () => request.resolve(tracks));

      expect(screen.getByRole("list", {
        name: "All releases",
      })).toBeInTheDocument();
      expect(libraryPane.scrollTop).toBe(312);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(document, "startViewTransition", originalDescriptor);
      } else {
        Reflect.deleteProperty(document, "startViewTransition");
      }
    }
  });

  it("opens a prefetched album through a warm snapshot and restores it instantly", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    const capturedTransitionClasses: string[] = [];
    const titleSnapshots: Array<{
      sourceBeforeUpdate: number;
      sourceIsStaticText: boolean;
      detailAfterUpdate: number;
      detailSurfaceAfterUpdate: number;
      metadataDetailAfterUpdate: number;
    }> = [];
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "startViewTransition",
    );
    const startViewTransition = vi.fn((
      update: () => void | Promise<void>,
    ) => {
      const sourceBeforeUpdate = document.querySelectorAll(
        "[data-coda-album-title-source]",
      ).length;
      const sourceIsStaticText = document.querySelector(
        "[data-coda-album-title-source]",
      )?.matches('[data-slot="overflow-marquee-text"]') ?? false;
      const updateCallbackDone = Promise.resolve(update()).then(() => {
        capturedTransitionClasses.push(document.documentElement.className);
        titleSnapshots.push({
          sourceBeforeUpdate,
          sourceIsStaticText,
          detailAfterUpdate: document.querySelectorAll(
            "[data-coda-album-title-detail]",
          ).length,
          detailSurfaceAfterUpdate: document.querySelectorAll(
            "[data-coda-album-detail-surface]",
          ).length,
          metadataDetailAfterUpdate: document.querySelectorAll(
            "[data-coda-album-metadata-detail]",
          ).length,
        });
      });
      return { finished: updateCallbackDone, updateCallbackDone };
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    try {
      const { queryClient } = renderApp();

      await screen.findByText("Soft Focus");
      queryClient.setQueryData(albumQueryKey(album.id), tracks);
      const openButton = screen.getByRole("link", {
        name: "Open Soft Focus",
      });
      const libraryPane = screen.getByRole("main");
      libraryPane.scrollTop = 312;
      openButton.focus();

      fireEvent.click(openButton);

      const albumPage = await screen.findByRole("article", {
        name: "Soft Focus release details",
      });
      expect(startViewTransition).toHaveBeenCalledOnce();
      expect(capturedTransitionClasses).toEqual([
        expect.stringContaining("coda-transition--album-detail"),
      ]);
      expect(titleSnapshots).toEqual([{
        sourceBeforeUpdate: 1,
        sourceIsStaticText: true,
        detailAfterUpdate: 1,
        detailSurfaceAfterUpdate: 1,
        metadataDetailAfterUpdate: 1,
      }]);
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(within(albumPage).getByText("First Light")).toBeInTheDocument();
      expect(within(albumPage).queryByRole("status")).not.toBeInTheDocument();

      fireEvent.click(within(albumPage).getByRole("button", {
        name: "Back",
      }));

      expect(startViewTransition).toHaveBeenCalledTimes(2);
      expect(await screen.findByRole("list", {
        name: "All releases",
      })).toBeInTheDocument();
      expect(
        document.querySelector("[data-coda-album-title-source]"),
      ).not.toBeInTheDocument();
      expect(libraryPane.scrollTop).toBe(312);
      await waitFor(() =>
        expect(screen.getByRole("link", {
          name: "Open Soft Focus",
        })).toHaveFocus()
      );
    } finally {
      document.documentElement.classList.remove(
        "coda-transition--album-detail",
      );
      if (originalDescriptor) {
        Object.defineProperty(document, "startViewTransition", originalDescriptor);
      } else {
        Reflect.deleteProperty(document, "startViewTransition");
      }
    }
  });

  it("morphs an Artist release into album detail and back to the exact card", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    const { queryClient } = renderApp();

    await screen.findByText("Soft Focus");
    fireEvent.click(screen.getByRole("button", { name: /Artists\s*1/ }));
    fireEvent.click(
      await screen.findByRole("link", { name: "Browse Night Archive" }),
    );
    await screen.findByRole("heading", { name: "Night Archive" });
    queryClient.setQueryData(albumQueryKey(album.id), tracks);

    const snapshots: Array<{
      artworkDetailAfterUpdate: number;
      artworkDetailBeforeUpdate: number;
      artworkReturnAfterUpdate: number;
      artworkSourceBeforeUpdate: number;
      className: string;
      titleDetailAfterUpdate: number;
      titleDetailBeforeUpdate: number;
      titleReturnAfterUpdate: number;
      titleSourceBeforeUpdate: number;
    }> = [];
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "startViewTransition",
    );
    const startViewTransition = vi.fn(
      (update: () => void | Promise<void>) => {
        const className = document.documentElement.className;
        const artworkSourceBeforeUpdate = document.querySelectorAll(
          ".coda-album-artwork-source",
        ).length;
        const titleSourceBeforeUpdate = document.querySelectorAll(
          "[data-coda-album-title-source]",
        ).length;
        const artworkDetailBeforeUpdate = document.querySelectorAll(
          "[data-coda-album-artwork-detail]",
        ).length;
        const titleDetailBeforeUpdate = document.querySelectorAll(
          "[data-coda-album-title-detail]",
        ).length;
        const updateCallbackDone = Promise.resolve(update()).then(() => {
          snapshots.push({
            artworkDetailAfterUpdate: document.querySelectorAll(
              "[data-coda-album-artwork-detail]",
            ).length,
            artworkDetailBeforeUpdate,
            artworkReturnAfterUpdate: document.querySelectorAll(
              "[data-coda-album-artwork-return]",
            ).length,
            artworkSourceBeforeUpdate,
            className,
            titleDetailAfterUpdate: document.querySelectorAll(
              "[data-coda-album-title-detail]",
            ).length,
            titleDetailBeforeUpdate,
            titleReturnAfterUpdate: document.querySelectorAll(
              "[data-coda-album-title-return]",
            ).length,
            titleSourceBeforeUpdate,
          });
        });
        return { finished: updateCallbackDone, updateCallbackDone };
      },
    );
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    try {
      const libraryPane = screen.getByRole("main");
      libraryPane.scrollTop = 246;
      const releaseLink = screen.getByRole("link", {
        name: "Open Soft Focus",
      });
      releaseLink.focus();
      fireEvent.click(releaseLink);

      const albumPage = await screen.findByRole("article", {
        name: "Soft Focus release details",
      });
      expect(snapshots.at(-1)).toEqual({
        artworkDetailAfterUpdate: 1,
        artworkDetailBeforeUpdate: 0,
        artworkReturnAfterUpdate: 0,
        artworkSourceBeforeUpdate: 1,
        className: expect.stringContaining("coda-transition--album-detail"),
        titleDetailAfterUpdate: 1,
        titleDetailBeforeUpdate: 0,
        titleReturnAfterUpdate: 0,
        titleSourceBeforeUpdate: 1,
      });

      fireEvent.click(
        within(albumPage).getByRole("button", { name: "Back" }),
      );

      expect(
        await screen.findByRole("heading", { name: "Night Archive" }),
      ).toBeInTheDocument();
      expect(snapshots.at(-1)).toEqual({
        artworkDetailAfterUpdate: 0,
        artworkDetailBeforeUpdate: 1,
        artworkReturnAfterUpdate: 1,
        artworkSourceBeforeUpdate: 0,
        className: expect.stringContaining(
          "coda-transition--album-detail-close",
        ),
        titleDetailAfterUpdate: 0,
        titleDetailBeforeUpdate: 1,
        titleReturnAfterUpdate: 1,
        titleSourceBeforeUpdate: 0,
      });
      expect(libraryPane.scrollTop).toBe(246);
      await waitFor(() =>
        expect(
          screen.getByRole("link", { name: "Open Soft Focus" }),
        ).toHaveFocus(),
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

  it("morphs a clicked artist cover forward and restores the virtualized list instantly", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    const snapshots: Array<{
      className: string;
      artworkSourceBeforeUpdate: number;
      artworkDetailBeforeUpdate: number;
      artworkDetailAfterUpdate: number;
      artworkReturnAfterUpdate: number;
      nameSourceBeforeUpdate: number;
      nameDetailBeforeUpdate: number;
      nameDetailAfterUpdate: number;
      nameReturnAfterUpdate: number;
      metadataDetailAfterUpdate: number;
    }> = [];
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "startViewTransition",
    );
    const startViewTransition = vi.fn((
      update: () => void | Promise<void>,
    ) => {
      const artworkSourceBeforeUpdate = document.querySelectorAll(
        "[data-coda-artist-artwork-source]",
      ).length;
      const nameSourceBeforeUpdate = document.querySelectorAll(
        "[data-coda-artist-name-source]",
      ).length;
      const artworkDetailBeforeUpdate = document.querySelectorAll(
        "[data-coda-artist-artwork-detail]",
      ).length;
      const nameDetailBeforeUpdate = document.querySelectorAll(
        "[data-coda-artist-name-detail]",
      ).length;
      const updateCallbackDone = Promise.resolve(update()).then(() => {
        snapshots.push({
          className: document.documentElement.className,
          artworkSourceBeforeUpdate,
          artworkDetailBeforeUpdate,
          artworkDetailAfterUpdate: document.querySelectorAll(
            "[data-coda-artist-artwork-detail]",
          ).length,
          artworkReturnAfterUpdate: document.querySelectorAll(
            "[data-coda-artist-artwork-return]",
          ).length,
          nameSourceBeforeUpdate,
          nameDetailBeforeUpdate,
          nameDetailAfterUpdate: document.querySelectorAll(
            "[data-coda-artist-name-detail]",
          ).length,
          nameReturnAfterUpdate: document.querySelectorAll(
            "[data-coda-artist-name-return]",
          ).length,
          metadataDetailAfterUpdate: document.querySelectorAll(
            "[data-coda-artist-metadata-detail]",
          ).length,
        });
      });
      return { finished: updateCallbackDone, updateCallbackDone };
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    try {
      renderApp();

      await screen.findByText("Soft Focus");
      fireEvent.click(screen.getByRole("button", { name: /Artists\s*1/ }));
      const libraryPane = screen.getByRole("main");
      libraryPane.scrollTop = 312;
      const artistCard = await screen.findByRole("link", {
        name: "Browse Night Archive",
      });
      artistCard.focus();

      fireEvent.click(artistCard);

      const artistHeading = await screen.findByRole("heading", {
        name: "Night Archive",
      });
      expect(
        artistHeading.closest("[data-coda-artist-detail-surface]"),
      ).not.toContainElement(screen.getByRole("button", { name: "Back" }));
      expect(startViewTransition).toHaveBeenCalledOnce();
      expect(snapshots).toEqual([{
        className: expect.stringContaining(
          "coda-transition--artist-detail",
        ),
        artworkSourceBeforeUpdate: 1,
        artworkDetailBeforeUpdate: 0,
        artworkDetailAfterUpdate: 1,
        artworkReturnAfterUpdate: 0,
        nameSourceBeforeUpdate: 1,
        nameDetailBeforeUpdate: 0,
        nameDetailAfterUpdate: 1,
        nameReturnAfterUpdate: 0,
        metadataDetailAfterUpdate: 1,
      }]);
      await waitFor(() => expect(artistHeading).toHaveFocus());
      expect(libraryPane.scrollTop).toBe(0);

      fireEvent.click(screen.getByRole("button", { name: "Back" }));

      expect(startViewTransition).toHaveBeenCalledTimes(2);
      expect(await screen.findByRole("list", {
        name: "Artists",
      })).toBeInTheDocument();
      expect(snapshots.at(-1)).toEqual({
        className: expect.stringContaining(
          "coda-transition--artist-detail-close",
        ),
        artworkSourceBeforeUpdate: 0,
        artworkDetailBeforeUpdate: 1,
        artworkDetailAfterUpdate: 0,
        artworkReturnAfterUpdate: 1,
        nameSourceBeforeUpdate: 0,
        nameDetailBeforeUpdate: 1,
        nameDetailAfterUpdate: 0,
        nameReturnAfterUpdate: 1,
        metadataDetailAfterUpdate: 0,
      });
      expect(libraryPane.scrollTop).toBe(312);
      await waitFor(() =>
        expect(screen.getByRole("link", {
          name: "Browse Night Archive",
        })).toHaveFocus()
      );
      expect(
        document.querySelector("[data-coda-artist-artwork-detail]"),
      ).not.toBeInTheDocument();
      expect(
        document.querySelector("[data-coda-artist-artwork-source]"),
      ).not.toBeInTheDocument();
      expect(
        document.querySelector("[data-coda-artist-name-source]"),
      ).not.toBeInTheDocument();
    } finally {
      document.documentElement.classList.remove(
        "coda-transition--artist-detail",
      );
      if (originalDescriptor) {
        Object.defineProperty(document, "startViewTransition", originalDescriptor);
      } else {
        Reflect.deleteProperty(document, "startViewTransition");
      }
    }
  });

  it("uses the targeted artist transition when an artist name opens the artist page", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    const snapshots: Array<{
      className: string;
      nameSourceBeforeUpdate: number;
      nameDetailAfterUpdate: number;
      detailSurfaceAfterUpdate: number;
      releaseGridAfterUpdate: number;
    }> = [];
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "startViewTransition",
    );
    const startViewTransition = vi.fn((
      update: () => void | Promise<void>,
    ) => {
      const nameSourceBeforeUpdate = document.querySelectorAll(
        "[data-coda-artist-name-source]",
      ).length;
      const updateCallbackDone = Promise.resolve(update()).then(() => {
        snapshots.push({
          className: document.documentElement.className,
          nameSourceBeforeUpdate,
          nameDetailAfterUpdate: document.querySelectorAll(
            "[data-coda-artist-name-detail]",
          ).length,
          detailSurfaceAfterUpdate: document.querySelectorAll(
            "[data-coda-artist-detail-surface]",
          ).length,
          releaseGridAfterUpdate: document.querySelectorAll(
            '[aria-label="Releases"]',
          ).length,
        });
      });
      return { finished: updateCallbackDone, updateCallbackDone };
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    try {
      const { queryClient } = renderApp();

      await screen.findByText("Soft Focus");
      queryClient.setQueryData(albumQueryKey(album.id), tracks);
    fireEvent.click(screen.getByRole("link", { name: "Open Soft Focus" }));
      const albumPage = await screen.findByRole("article", {
        name: "Soft Focus release details",
      });
      const artistLink = within(albumPage).getByTitle("Night Archive");
      artistLink.focus();
      startViewTransition.mockClear();
      snapshots.length = 0;

      fireEvent.click(artistLink);

      const artistHeading = await screen.findByRole("heading", {
        name: "Night Archive",
      });
      expect(startViewTransition).toHaveBeenCalledOnce();
      expect(snapshots).toEqual([{
        className: expect.stringContaining(
          "coda-transition--artist-detail",
        ),
        nameSourceBeforeUpdate: 1,
        nameDetailAfterUpdate: 1,
        detailSurfaceAfterUpdate: 1,
        releaseGridAfterUpdate: 1,
      }]);
      expect(document.documentElement).not.toHaveClass(
        "coda-transition--page-forward",
      );
      expect(artistHeading).toHaveFocus();
    } finally {
      document.documentElement.classList.remove(
        "coda-transition--artist-detail",
        "coda-transition--page-forward",
      );
      if (originalDescriptor) {
        Object.defineProperty(document, "startViewTransition", originalDescriptor);
      } else {
        Reflect.deleteProperty(document, "startViewTransition");
      }
    }
  });

  it("opens Now Playing from the player artwork and returns to the exact prior view", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    renderApp();

    await screen.findByText("Soft Focus");
    fireEvent.click(screen.getByRole("link", { name: "Open Soft Focus" }));
    const albumPage = await screen.findByRole("article", { name: "Soft Focus release details" });
    fireEvent.click(within(albumPage).getByRole("button", { name: "Play album" }));

    fireEvent.click(await screen.findByRole("link", { name: "Open Now Playing" }));
    const nowPlaying = await screen.findByRole("article", { name: "First Light" });
    expect(within(nowPlaying).getByText("Playing now")).toBeInTheDocument();
    expect(within(nowPlaying).queryByText("Now playing")).not.toBeInTheDocument();
    expect(within(nowPlaying).getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();
    expect(within(nowPlaying).getByRole("heading", { name: "First Light" })).toHaveFocus();
    expect(document.title).toBe("First Light — Coda");

    fireEvent.click(within(nowPlaying).getByRole("button", {
      name: "Back",
    }));
    expect(await screen.findByRole("article", {
      name: "Soft Focus release details",
    })).toBeInTheDocument();
    const miniArtwork = await screen.findByRole("link", {
      name: "Open Now Playing",
    });
    expect(miniArtwork).toBeInTheDocument();
    await waitFor(() => expect(miniArtwork).toHaveFocus());
  });

  it("matches album and track controls to the current playing and paused state", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    renderApp();

    await screen.findByText("Soft Focus");
    fireEvent.click(screen.getByRole("link", { name: "Open Soft Focus" }));
    const albumPage = await screen.findByRole("article", {
      name: "Soft Focus release details",
    });
    fireEvent.click(within(albumPage).getByRole("button", { name: "Play album" }));

    expect(await within(albumPage).findByRole("button", {
      name: "Pause Soft Focus",
    })).toHaveAttribute("aria-pressed", "true");
    const pauseTrack = within(albumPage).getByRole("button", {
      name: "Pause First Light",
    });
    expect(pauseTrack).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(pauseTrack);
    expect(within(albumPage).getByRole("button", { name: "Resume Soft Focus" }))
      .toHaveAttribute("aria-pressed", "false");
    expect(within(albumPage).getByRole("button", { name: "Resume First Light" }))
      .toHaveAttribute("aria-pressed", "false");
  });

  it("bounds a 25,000-track album while keeping visible track controls accessible", async () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    const originalResizeObserver = globalThis.ResizeObserver;
    class ResizeObserverMock implements ResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) {}
      disconnect() {}
      observe(target: Element) {
        const bounds = target.getBoundingClientRect();
        this.callback([resizeObserverEntry(target, bounds)], this);
      }
      unobserve() {}
    }
    globalThis.ResizeObserver = ResizeObserverMock;
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      if (this.hasAttribute("data-coda-library-scroll")) {
        return new DOMRect(0, 0, 360, 240);
      }
      if (this.getAttribute("aria-label") === "Album tracks") {
        return new DOMRect(0, 90, 360, 0);
      }
      return originalRect.call(this);
    };
    const largeTracks: Track[] = Array.from({ length: 25_000 }, (_, index) => ({
      ...tracks[0],
      id: `large-track-${index + 1}`,
      title: `Album track ${index + 1}`,
      track: index + 1,
    }));
    const largeAlbum: Album = {
      ...album,
      duration: largeTracks.reduce((total, track) => total + track.duration, 0),
      songCount: largeTracks.length,
      tracks: undefined,
    };
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([largeAlbum]);
    mocks.fetchAlbum.mockResolvedValue(largeTracks);
    mocks.fetchFavorites
      .mockResolvedValueOnce({ albumIds: [], songIds: [], albums: [], tracks: [] })
      .mockResolvedValue({
        albumIds: [],
        songIds: [largeTracks[0].id],
        albums: [],
        tracks: [largeTracks[0]],
      });
    try {
      renderApp();

      await screen.findByText("Soft Focus");
      fireEvent.click(screen.getByRole("link", { name: "Open Soft Focus" }));
      const albumPage = await screen.findByRole("article", {
        name: "Soft Focus release details",
      });
      const trackList = await within(albumPage).findByRole("list", {
        name: "Album tracks",
      });

      await waitFor(() => {
        const visibleRows = within(trackList).getAllByRole("listitem");
        expect(visibleRows.length).toBeGreaterThan(0);
        expect(visibleRows.length).toBeLessThan(30);
      }, { timeout: 5_000 });
      const firstRow = within(trackList).getAllByRole("listitem")[0];
      expect(firstRow).toHaveAttribute("aria-posinset", "1");
      expect(firstRow).toHaveAttribute("aria-setsize", "25000");
      expect(within(trackList).queryByText("Album track 25000"))
        .not.toBeInTheDocument();

      fireEvent.click(within(trackList).getByRole("button", {
        name: "Play Album track 1",
      }));
      expect(await within(trackList).findByRole("button", {
        name: "Pause Album track 1",
      })).toHaveAttribute("aria-pressed", "true");

      fireEvent.click(within(trackList).getByRole("button", {
        name: "Add Album track 1 to favorites",
      }));
      expect(await within(trackList).findByRole("button", {
        name: "Remove Album track 1 from favorites",
      })).toHaveAttribute("aria-pressed", "true");
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect;
      globalThis.ResizeObserver = originalResizeObserver;
    }
  });
});
