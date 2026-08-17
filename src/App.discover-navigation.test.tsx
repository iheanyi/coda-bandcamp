import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Album, Track } from "./types";
import { album, mocks, renderApp, tracks } from "./test/appTestHarness";

describe("Coda Discover and Now Playing navigation flows", () => {

  it("uses a shared-element view transition when the WebView supports it", async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "startViewTransition",
    );
    const titleSnapshots: Array<{
      compactBeforeUpdate: number;
      detailBeforeUpdate: number;
      compactAfterUpdate: number;
      detailAfterUpdate: number;
    }> = [];
    const startViewTransition = vi.fn((
      update: () => void | Promise<void>,
    ) => {
      const compactBeforeUpdate = document.querySelectorAll(
        "[data-coda-now-playing-title-compact]",
      ).length;
      const detailBeforeUpdate = document.querySelectorAll(
        "[data-coda-now-playing-title-detail]",
      ).length;
      const updateCallbackDone = Promise.resolve(update()).then(() => {
        titleSnapshots.push({
          compactBeforeUpdate,
          detailBeforeUpdate,
          compactAfterUpdate: document.querySelectorAll(
            "[data-coda-now-playing-title-compact]",
          ).length,
          detailAfterUpdate: document.querySelectorAll(
            "[data-coda-now-playing-title-detail]",
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
      mocks.hasConnection.mockResolvedValue(true);
      mocks.fetchLibrary.mockResolvedValue([album]);
      renderApp();

      await screen.findByText("Soft Focus");
      fireEvent.click(screen.getByRole("button", { name: "Play Soft Focus" }));
      fireEvent.click(await screen.findByRole("link", { name: "Open Now Playing" }));

      const nowPlaying = await screen.findByRole("article", { name: "First Light" });
      expect(startViewTransition).toHaveBeenCalledOnce();
      expect(titleSnapshots).toEqual([{
        compactBeforeUpdate: 1,
        detailBeforeUpdate: 0,
        compactAfterUpdate: 0,
        detailAfterUpdate: 1,
      }]);

      fireEvent.click(within(nowPlaying).getByRole("button", {
        name: "Back",
      }));
      await screen.findByRole("link", { name: "Open Now Playing" });
      expect(startViewTransition).toHaveBeenCalledTimes(2);
      await waitFor(() => expect(titleSnapshots).toHaveLength(2));
      expect(titleSnapshots).toEqual([
        {
          compactBeforeUpdate: 1,
          detailBeforeUpdate: 0,
          compactAfterUpdate: 0,
          detailAfterUpdate: 1,
        },
        {
          compactBeforeUpdate: 0,
          detailBeforeUpdate: 1,
          compactAfterUpdate: 1,
          detailAfterUpdate: 0,
        },
      ]);
      await waitFor(() =>
        expect(screen.getByRole("link", { name: "Open Now Playing" })).toHaveFocus(),
      );
    } finally {
      document.documentElement.classList.remove(
        "coda-view-transitioning",
        "coda-view-transitions-supported",
      );
      if (originalDescriptor) {
        Object.defineProperty(document, "startViewTransition", originalDescriptor);
      } else {
        Reflect.deleteProperty(document, "startViewTransition");
      }
    }
  });

  it("links Now Playing metadata to artist and album pages", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    const { unmount } = renderApp();

    await screen.findByText("Soft Focus");
    fireEvent.click(screen.getByRole("button", { name: "Play Soft Focus" }));
    fireEvent.click(await screen.findByRole("link", { name: "Open Now Playing" }));
    let nowPlaying = await screen.findByRole("article", { name: "First Light" });
    const currentTrack = within(nowPlaying).getByRole("region", {
      name: "Current track",
    });
    fireEvent.click(within(currentTrack).getByRole("link", {
      name: "Night Archive",
    }));
    expect(await screen.findByRole("heading", { name: "Night Archive" })).toBeInTheDocument();

    unmount();
    renderApp();
    await screen.findByText("Soft Focus");
    fireEvent.click(screen.getByRole("button", { name: "Play Soft Focus" }));
    fireEvent.click(await screen.findByRole("link", { name: "Open Now Playing" }));
    nowPlaying = await screen.findByRole("article", { name: "First Light" });
    const currentTrackAgain = within(nowPlaying).getByRole("region", {
      name: "Current track",
    });
    fireEvent.click(within(currentTrackAgain).getByRole("link", {
      name: "Soft Focus",
    }));
    expect(await screen.findByRole("article", {
      name: "Soft Focus release details",
    })).toBeInTheDocument();
  });

  it("keeps Now Playing open when an artist destination cannot be resolved", async () => {
    const orphanTrack: Track = {
      ...tracks[0],
      id: "orphan-track",
      artist: "Missing Artist",
      album: "Missing Release",
      albumId: "missing-album",
      streamUrl: undefined,
    };
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    mocks.loadPlayerState.mockResolvedValue({
      version: 1,
      savedAt: Date.now(),
      queue: [orphanTrack],
      currentIndex: 0,
      positionSeconds: 0,
      volume: 0.72,
      repeatMode: "off",
      queueOpen: false,
    });
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "startViewTransition",
    );
    const startViewTransition = vi.fn((update: () => void | Promise<void>) => {
      update();
      return { finished: Promise.resolve() };
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    try {
      renderApp();

      fireEvent.click(await screen.findByRole("link", {
        name: "Open Now Playing",
      }));
      const nowPlaying = await screen.findByRole("article", {
        name: "First Light",
      });
      startViewTransition.mockClear();

      fireEvent.click(within(nowPlaying).getByRole("link", {
        name: "Missing Artist",
      }));

      expect(startViewTransition).not.toHaveBeenCalled();
      expect(screen.getByRole("article", { name: "First Light" }))
        .toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Could not find a saved release for Missing Artist.",
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

  it("opens Discover album metadata as an internal release and returns to Now Playing", async () => {
    renderApp();

    fireEvent.click(await screen.findByRole("link", { name: "Discover" }));
    await screen.findByText("Blue Hours");
    fireEvent.click(screen.getByRole("button", { name: "Rock" }));
    await waitFor(() =>
      expect(mocks.fetchDiscover).toHaveBeenLastCalledWith(
        expect.objectContaining({ tag: "rock", sort: "top" }),
        "*",
      ),
    );
    await screen.findByText("Blue Hours");
    const libraryPane = screen.getByRole("main");
    libraryPane.scrollTop = 312;
    fireEvent.click(screen.getByRole("button", { name: "Preview Glass Lines" }));
    fireEvent.click(await screen.findByRole("link", { name: "Open Now Playing" }));

    const nowPlaying = await screen.findByRole("article", { name: "Glass Lines" });
    expect(libraryPane.scrollTop).toBe(0);
    libraryPane.scrollTop = 88;
    mocks.fetchAlbum.mockClear();
    fireEvent.click(within(nowPlaying).getByRole("link", { name: "Blue Hours" }));

    const releaseDetail = await screen.findByRole("article", {
      name: "Blue Hours",
    });
    await waitFor(() =>
      expect(within(releaseDetail).getByRole("heading", { name: "Blue Hours" }))
        .toHaveFocus(),
    );
    expect(within(releaseDetail).getByRole("button", { name: "Signal Garden" }))
      .toBeInTheDocument();
    expect(mocks.fetchAlbum).not.toHaveBeenCalled();

    fireEvent.click(within(releaseDetail).getByRole("button", { name: "Back" }));
    const restoredNowPlaying = await screen.findByRole("article", { name: "Glass Lines" });
    expect(restoredNowPlaying).toBeInTheDocument();
    await waitFor(() =>
      expect(within(restoredNowPlaying).getByRole("heading", {
        name: "Glass Lines",
      })).toHaveFocus(),
    );
    await waitFor(() => expect(libraryPane.scrollTop).toBe(88));
    expect(mocks.fetchAlbum).not.toHaveBeenCalled();

    fireEvent.click(within(restoredNowPlaying).getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "Discover" }))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rock" }))
      .toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(libraryPane.scrollTop).toBe(312));
    expect(within(screen.getByRole("main")).getByRole("link", {
      name: "Blue Hours",
    })).toBeInTheDocument();
  });

  it("morphs Now Playing artwork and release title into Discover detail", async () => {
    renderApp();

    fireEvent.click(await screen.findByRole("link", { name: "Discover" }));
    await screen.findByText("Blue Hours");
    fireEvent.click(screen.getByRole("button", { name: "Preview Glass Lines" }));
    fireEvent.click(await screen.findByRole("link", {
      name: "Open Now Playing",
    }));
    const nowPlaying = await screen.findByRole("article", { name: "Glass Lines" });
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
        ".now-playing__artwork[data-coda-discover-artwork-source]",
      ).length;
      const titleSourceBeforeUpdate = document.querySelectorAll(
        '[data-coda-discover-title-source][data-slot="overflow-marquee-text"]',
      ).length;
      const finished = Promise.resolve(update()).then(() => {
        snapshots.push({
          className: document.documentElement.className,
          artworkSourceBeforeUpdate,
          titleSourceBeforeUpdate,
          artworkDetailAfterUpdate: document.querySelectorAll(
            "[data-coda-discover-artwork-detail]",
          ).length,
          titleDetailAfterUpdate: document.querySelectorAll(
            "[data-coda-discover-title-detail]",
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
      fireEvent.click(within(nowPlaying).getByRole("link", {
        name: "Blue Hours",
      }));

      expect(startViewTransition).toHaveBeenCalledOnce();
      await waitFor(() =>
        expect(snapshots).toEqual([{
          className: expect.stringContaining(
            "coda-transition--discover-detail",
          ),
          artworkSourceBeforeUpdate: 1,
          titleSourceBeforeUpdate: 1,
          artworkDetailAfterUpdate: 1,
          titleDetailAfterUpdate: 1,
        }]),
      );
      const releaseDetail = await screen.findByRole("article", {
        name: "Blue Hours",
      });
      fireEvent.click(within(releaseDetail).getByRole("button", {
        name: "Back",
      }));

      // Returning to the non-card Now Playing context is a snapshot-free live
      // page Back; only the forward shared-element morph owns a native one.
      expect(startViewTransition).toHaveBeenCalledOnce();
      expect(await screen.findByRole("article", { name: "Glass Lines" }))
        .toBeInTheDocument();
    } finally {
      document.documentElement.classList.remove(
        "coda-transition--discover-detail",
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

  it("preserves the Discover parent through detail and compact-player navigation", async () => {
    renderApp();

    fireEvent.click(await screen.findByRole("link", { name: "Discover" }));
    await screen.findByText("Blue Hours");
    fireEvent.click(screen.getByRole("button", { name: "Rock" }));
    await waitFor(() =>
      expect(mocks.fetchDiscover).toHaveBeenLastCalledWith(
        expect.objectContaining({ tag: "rock", sort: "top" }),
        "*",
      ),
    );
    await screen.findByText("Blue Hours");
    fireEvent.click(screen.getByRole("button", { name: "Preview Glass Lines" }));

    const libraryPane = screen.getByRole("main");
    libraryPane.scrollTop = 312;
    const player = screen.getByRole("contentinfo");
    const compactAlbumLink = within(player).getByRole("link", {
      name: "Blue Hours",
    });
    fireEvent.click(compactAlbumLink);

    let releaseDetail = await screen.findByRole("article", {
      name: "Blue Hours",
    });
    libraryPane.scrollTop = 88;
    fireEvent.click(within(player).getByRole("link", {
      name: "Blue Hours",
    }));
    releaseDetail = await screen.findByRole("article", { name: "Blue Hours" });
    libraryPane.scrollTop = 88;
    fireEvent.click(within(player).getByRole("link", {
      name: "Open Now Playing",
    }));

    const nowPlaying = await screen.findByRole("article", {
      name: "Glass Lines",
    });
    expect(libraryPane.scrollTop).toBe(0);
    fireEvent.click(within(nowPlaying).getByRole("button", { name: "Back" }));

    releaseDetail = await screen.findByRole("article", { name: "Blue Hours" });
    expect(libraryPane.scrollTop).toBe(88);
    await waitFor(() =>
      expect(within(releaseDetail).getByRole("heading", { name: "Blue Hours" }))
        .toHaveFocus(),
    );
    fireEvent.click(within(releaseDetail).getByRole("button", { name: "Back" }));

    expect(await screen.findByRole("button", { name: "Rock" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(libraryPane.scrollTop).toBe(312);
    await waitFor(() =>
      expect(within(screen.getByRole("contentinfo")).getByRole("link", {
        name: "Blue Hours",
      })).toHaveFocus(),
    );
  });

  it("restores Discover filters and scroll after opening release artwork", async () => {
    renderApp();

    fireEvent.click(await screen.findByRole("link", { name: "Discover" }));
    await screen.findByRole("link", {
      name: "Open Blue Hours Discover details",
    });
    fireEvent.click(screen.getByRole("button", { name: "Rock" }));
    await waitFor(() =>
      expect(mocks.fetchDiscover).toHaveBeenLastCalledWith(
        expect.objectContaining({ tag: "rock", sort: "top" }),
        "*",
      ),
    );
    await screen.findByRole("link", {
      name: "Open Blue Hours Discover details",
    });

    const libraryPane = screen.getByRole("main");
    libraryPane.scrollTop = 312;
    fireEvent.scroll(libraryPane);
    const artworkLink = within(libraryPane).getByRole("link", {
      name: "Open Blue Hours Discover details",
    });
    fireEvent.click(artworkLink);

    const releaseDetail = await screen.findByRole("article", {
      name: "Blue Hours",
    });
    const backButton = within(releaseDetail).getByRole("button", { name: "Back" });
    await waitFor(() =>
      expect(within(releaseDetail).getByRole("heading", { name: "Blue Hours" }))
        .toHaveFocus(),
    );
    libraryPane.scrollTop = 0;
    fireEvent.click(backButton);

    expect(await screen.findByRole("button", { name: "Rock" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Search Discover by tag")).toHaveValue("rock");
    await waitFor(() => expect(libraryPane.scrollTop).toBe(312));
    await waitFor(() => expect(artworkLink).toHaveFocus());
  });

  it("morphs Discover artwork and title into the release detail", async () => {
    renderApp();

    fireEvent.click(await screen.findByRole("link", { name: "Discover" }));
    const titleLink = await screen.findByRole("link", {
      name: "Blue Hours",
    });
    const snapshots: Array<{
      className: string;
      artworkSourceBeforeUpdate: number;
      artworkDetailAfterUpdate: number;
      titleSourceBeforeUpdate: number;
      titleDetailAfterUpdate: number;
      detailSurfaceAfterUpdate: number;
    }> = [];
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "startViewTransition",
    );
    const startViewTransition = vi.fn((update: () => void) => {
      const artworkSourceBeforeUpdate = document.querySelectorAll(
        "[data-coda-discover-artwork-source]",
      ).length;
      const titleSourceBeforeUpdate = document.querySelectorAll(
        "[data-coda-discover-title-source]",
      ).length;
      const finished = Promise.resolve(update()).then(() => {
        snapshots.push({
          className: document.documentElement.className,
          artworkSourceBeforeUpdate,
          artworkDetailAfterUpdate: document.querySelectorAll(
            "[data-coda-discover-artwork-detail]",
          ).length,
          titleSourceBeforeUpdate,
          titleDetailAfterUpdate: document.querySelectorAll(
            "[data-coda-discover-title-detail]",
          ).length,
          detailSurfaceAfterUpdate: document.querySelectorAll(
            "[data-coda-discover-detail-surface]",
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
      fireEvent.click(titleLink);

      expect(startViewTransition).toHaveBeenCalledOnce();
      await waitFor(() => expect(snapshots).toEqual([{
        className: expect.stringContaining(
          "coda-transition--discover-detail",
        ),
        artworkSourceBeforeUpdate: 1,
        artworkDetailAfterUpdate: 1,
        titleSourceBeforeUpdate: 1,
        titleDetailAfterUpdate: 1,
        detailSurfaceAfterUpdate: 1,
      }]));
      const releaseDetail = await screen.findByRole("article", {
        name: "Blue Hours",
      });

      fireEvent.click(within(releaseDetail).getByRole("button", {
        name: "Back",
      }));

      expect(startViewTransition).toHaveBeenCalledTimes(2);
      expect(await screen.findByRole("link", { name: "Blue Hours" }))
        .toBeInTheDocument();
      expect(
        document.querySelector("[data-coda-discover-title-source]"),
      ).not.toBeInTheDocument();
    } finally {
      document.documentElement.classList.remove(
        "coda-transition--discover-detail",
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

  it("uses the Discover sidebar as a state-preserving detail exit", async () => {
    renderApp();

    const discoverNavigation = await screen.findByRole("link", {
      name: "Discover",
    });
    fireEvent.click(discoverNavigation);
    await screen.findByText("Blue Hours");
    fireEvent.click(screen.getByRole("button", { name: "Rock" }));
    await waitFor(() =>
      expect(mocks.fetchDiscover).toHaveBeenLastCalledWith(
        expect.objectContaining({ tag: "rock", sort: "top" }),
        "*",
      ),
    );
    await screen.findByText("Blue Hours");

    const libraryPane = screen.getByRole("main");
    libraryPane.scrollTop = 312;
    fireEvent.click(screen.getByRole("link", {
      name: "Open Blue Hours Discover details",
    }));
    await screen.findByRole("article", { name: "Blue Hours" });
    libraryPane.scrollTop = 88;

    discoverNavigation.focus();
    fireEvent.click(discoverNavigation);

    expect(await screen.findByRole("button", { name: "Rock" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("article", { name: "Blue Hours" }))
      .not.toBeInTheDocument();
    expect(libraryPane.scrollTop).toBe(312);
    expect(discoverNavigation).toHaveFocus();
  });

  it("does not leak Discover detail metadata after navigating to another route", async () => {
    const { router } = renderApp();

    fireEvent.click(await screen.findByRole("link", { name: "Discover" }));
    fireEvent.click(await screen.findByRole("link", { name: "Blue Hours" }));
    await screen.findByRole("article", { name: "Blue Hours" });
    expect(document.title).toBe("Blue Hours — Coda");

    fireEvent.click(screen.getByRole("link", { name: "Collection" }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/collection"),
    );
    await waitFor(() => expect(document.title).toBe("Coda"));
  });

  it("keeps loaded Discover pages mounted while viewing release details", async () => {
    mocks.fetchDiscover
      .mockResolvedValueOnce({
        results: [{
          id: "discover:release-1",
          title: "Blue Hours",
          artist: "Signal Garden",
          location: "Chicago, Illinois",
          itemUrl: "https://signal-garden.bandcamp.com/album/blue-hours",
          artworkUrl: "https://f4.bcbits.com/img/blue-hours.jpg",
        }],
        resultCount: 2,
        hasMore: true,
        cursor: "next-page",
      })
      .mockResolvedValueOnce({
        results: [{
          id: "discover:release-2",
          title: "Amber Transit",
          artist: "Signal Garden",
          location: "Chicago, Illinois",
          itemUrl: "https://signal-garden.bandcamp.com/album/amber-transit",
        }],
        resultCount: 2,
        hasMore: false,
      });
    renderApp();

    fireEvent.click(await screen.findByRole("link", { name: "Discover" }));
    await screen.findByText("Blue Hours");
    fireEvent.click(screen.getByRole("button", {
      name: "View more discoveries",
    }));
    expect(await screen.findByText("Amber Transit")).toBeInTheDocument();
    expect(mocks.fetchDiscover).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("link", {
      name: "Open Blue Hours Discover details",
    }));
    const releaseDetail = await screen.findByRole("article", {
      name: "Blue Hours",
    });
    fireEvent.click(within(releaseDetail).getByRole("button", { name: "Back" }));

    expect(await screen.findByText("Blue Hours")).toBeInTheDocument();
    expect(screen.getByText("Amber Transit")).toBeInTheDocument();
    expect(mocks.fetchDiscover).toHaveBeenCalledTimes(2);
  });

  it("opens a Discover artist on Bandcamp without entering a same-name library artist", async () => {
    const sameNameLibraryAlbum: Album = {
      ...album,
      id: "saved-signal-garden",
      title: "Saved Signals",
      artist: "Signal Garden",
      tracks: tracks.map((track) => ({
        ...track,
        albumId: "saved-signal-garden",
        album: "Saved Signals",
        artist: "Signal Garden",
      })),
    };
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([sameNameLibraryAlbum]);
    renderApp();

    fireEvent.click(await screen.findByRole("link", { name: "Discover" }));
    await screen.findByText("Blue Hours");
    fireEvent.click(screen.getByRole("button", { name: "Preview Glass Lines" }));
    fireEvent.click(await screen.findByRole("link", { name: "Open Now Playing" }));

    const nowPlaying = await screen.findByRole("article", { name: "Glass Lines" });
    mocks.fetchAlbum.mockClear();
    fireEvent.click(within(nowPlaying).getByRole("button", {
      name: "Open artist Signal Garden on Bandcamp",
    }));

    await waitFor(() =>
      expect(mocks.openBandcampUrl).toHaveBeenCalledWith(
        "https://signal-garden.bandcamp.com/",
      ),
    );
    expect(screen.getByRole("article", { name: "Glass Lines" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Signal Garden" }))
      .not.toBeInTheDocument();
    expect(mocks.fetchAlbum).not.toHaveBeenCalled();
  });

  it("opens sidebar Discover at /discover when a release was opened from Radio", async () => {
    const { router } = renderApp();

    fireEvent.click(await screen.findByRole("link", { name: "Discover" }));
    await screen.findByText("Blue Hours");
    fireEvent.click(screen.getByRole("button", { name: "Preview Glass Lines" }));
    fireEvent.click(await screen.findByRole("link", { name: "Bandcamp Radio" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/radio");
    });

    const player = screen.getByRole("contentinfo");
    fireEvent.click(within(player).getByRole("link", { name: "Blue Hours" }));
    await screen.findByRole("article", { name: "Blue Hours" });
    expect(router.state.location.pathname).toContain("/discover/releases/");

    fireEvent.click(screen.getByRole("link", { name: "Discover" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/discover");
    });
    expect(screen.queryByRole("article", { name: "Blue Hours" }))
      .not.toBeInTheDocument();
  });

  it("keeps Now Playing intact when a Discover release destination is invalid", async () => {
    mocks.fetchDiscover.mockResolvedValue({
      results: [{
        id: "release-without-discover-provenance",
        title: "Blue Hours",
        artist: "Signal Garden",
        itemUrl: "https://signal-garden.bandcamp.com/album/blue-hours",
        featuredTrack: {
          id: "discover:preview-1",
          title: "Glass Lines",
          duration: 201,
          streamUrl: "https://t4.bcbits.com/stream/blue-hours",
        },
      }],
      resultCount: 1,
      hasMore: false,
    });
    renderApp();

    fireEvent.click(await screen.findByRole("link", { name: "Discover" }));
    await screen.findByText("Blue Hours");
    fireEvent.click(screen.getByRole("button", { name: "Preview Glass Lines" }));
    fireEvent.click(await screen.findByRole("link", { name: "Open Now Playing" }));

    const nowPlaying = await screen.findByRole("article", { name: "Glass Lines" });
    mocks.fetchAlbum.mockClear();
    fireEvent.click(within(nowPlaying).getByRole("button", { name: "Blue Hours" }));

    expect(screen.getByRole("article", { name: "Glass Lines" })).toBeInTheDocument();
    expect((await screen.findAllByText(
      "Could not open Blue Hours from Discover",
    )).length).toBeGreaterThan(0);
    expect(mocks.fetchAlbum).not.toHaveBeenCalled();
  });
});
