import {
  act,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PlaylistDetail } from "@/types";
import {
  deferred,
  detail,
  mocks,
  otherSummary,
  type PlaylistIdentityTransitionSnapshot,
  type PlaylistReturnSnapshot,
  renderSavedLibraryRoute,
  summary,
} from "./test/savedLibraryViewTestHarness";

describe("saved-library playlist navigation", () => {
  it("navigates from the route list with a validated playlist identity", async () => {
    const { router } = renderSavedLibraryRoute({
      initialEntry: "/playlists",
    });

    const trigger = await screen.findByRole("link", { name: /Night drive/ });
    fireEvent.click(trigger);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/playlists/playlist-1");
    });
    expect(mocks.fetchPlaylist).toHaveBeenCalledWith("playlist-1");
  });

  it("loads a direct playlist detail by controlled ID without waiting for the list", async () => {
    mocks.fetchPlaylists.mockReturnValueOnce(new Promise(() => undefined));
    const { router } = renderSavedLibraryRoute({
      initialEntry: "/playlists/playlist-1",
    });

    const heading = await screen.findByRole("heading", { name: "Night drive" });
    expect(heading).toHaveFocus();
    expect(mocks.fetchPlaylist).toHaveBeenCalledWith("playlist-1");
    expect(mocks.fetchPlaylists).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/playlists");
    });
  });

  it("opens a cold playlist directly into its live loading state", async () => {
    const playlistRequest = deferred<PlaylistDetail>();
    mocks.fetchPlaylist.mockReturnValueOnce(playlistRequest.promise);
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "startViewTransition",
    );
    const startViewTransition = vi.fn();
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    try {
      renderSavedLibraryRoute({ initialEntry: "/playlists" });

      const playlistButton = await screen.findByRole("link", {
        name: /Night drive/,
      });
      fireEvent.click(playlistButton);

      expect(document.documentElement).toHaveClass(
        "coda-transition--page-forward",
      );
      expect(startViewTransition).not.toHaveBeenCalled();
      const loadingHeading = await screen.findByText("Opening playlist…");
      const loadingSurface = loadingHeading.parentElement;
      expect(
        loadingSurface?.querySelectorAll('[data-slot="spinner"]'),
      ).toHaveLength(1);
      expect(
        loadingSurface?.querySelector('[data-slot="skeleton"]'),
      ).not.toBeInTheDocument();
    } finally {
      await act(async () => {
        playlistRequest.resolve(detail);
        await Promise.resolve();
      });
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

  it("uses a directional Back transition after a cold playlist finishes opening", async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "startViewTransition",
    );
    const startViewTransition = vi.fn();
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    try {
      renderSavedLibraryRoute({ initialEntry: "/playlists" });

      fireEvent.click(
        await screen.findByRole("link", {
          name: /Night drive/,
        }),
      );
      expect(
        await screen.findByRole("heading", { name: "Night drive" }),
      ).toBeInTheDocument();
      expect(startViewTransition).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Back" }));
      expect(document.documentElement).toHaveClass(
        "coda-transition--page-back",
      );

      expect(
        await screen.findByRole("link", { name: /Night drive/ }),
      ).toBeInTheDocument();
      expect(startViewTransition).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(document.documentElement).not.toHaveClass(
          "coda-transition--page-back",
        ),
      );
      expect(
        document.querySelector("[data-coda-playlist-identity-return]"),
      ).not.toBeInTheDocument();
    } finally {
      vi.unstubAllEnvs();
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

  it("pairs a warm playlist identity with its detail and returning row", async () => {
    mocks.fetchPlaylists.mockResolvedValueOnce([summary, otherSummary]);
    const snapshots: PlaylistIdentityTransitionSnapshot[] = [];
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "startViewTransition",
    );
    const startViewTransition = vi.fn(
      (update: () => void | Promise<void>) => {
      const snapshot: PlaylistIdentityTransitionSnapshot = {
        className: document.documentElement.className,
        beforeDetail: document.querySelector<HTMLElement>(
          "[data-coda-playlist-identity-detail]",
        )?.dataset.codaPlaylistIdentityDetail,
        beforeSource: document.querySelector<HTMLElement>(
          "[data-coda-playlist-identity-source]",
        )?.dataset.codaPlaylistIdentitySource,
        beforeTitleDetail: document.querySelector<HTMLElement>(
          "[data-coda-playlist-title-detail]",
        )?.dataset.codaPlaylistTitleDetail,
        beforeTitleSource: document.querySelector<HTMLElement>(
          "[data-coda-playlist-title-source]",
        )?.dataset.codaPlaylistTitleSource,
        beforeTitleSourceIsStatic:
          document
            .querySelector("[data-coda-playlist-title-source]")
            ?.matches('[data-slot="overflow-marquee-text"]') ?? false,
        afterTitleReturnIsStatic: false,
      };
      expect(
        document.querySelectorAll("[data-coda-playlist-identity-source]"),
      ).toHaveLength(snapshot.beforeSource ? 1 : 0);
      expect(
        document.querySelectorAll("[data-coda-playlist-title-source]"),
      ).toHaveLength(snapshot.beforeTitleSource ? 1 : 0);
      const finished = Promise.resolve(update()).then(() => {
        snapshot.afterDetail = document.querySelector<HTMLElement>(
          "[data-coda-playlist-identity-detail]",
        )?.dataset.codaPlaylistIdentityDetail;
        snapshot.afterReturn = document.querySelector<HTMLElement>(
          "[data-coda-playlist-identity-return]",
        )?.dataset.codaPlaylistIdentityReturn;
        snapshot.afterTitleDetail = document.querySelector<HTMLElement>(
          "[data-coda-playlist-title-detail]",
        )?.dataset.codaPlaylistTitleDetail;
        snapshot.afterTitleReturn = document.querySelector<HTMLElement>(
          "[data-coda-playlist-title-return]",
        )?.dataset.codaPlaylistTitleReturn;
        snapshot.afterTitleReturnIsStatic =
          document
            .querySelector("[data-coda-playlist-title-return]")
            ?.matches('[data-slot="overflow-marquee-text"]') ?? false;
        const identityTarget = document.querySelector<HTMLElement>(
          "[data-coda-playlist-identity-detail], [data-coda-playlist-identity-return]",
        );
        const titleTarget = document.querySelector<HTMLElement>(
          "[data-coda-playlist-title-detail], [data-coda-playlist-title-return]",
        );
        snapshot.identityAndTitleAreSeparate =
          Boolean(identityTarget) &&
          Boolean(titleTarget) &&
          identityTarget !== titleTarget;
        expect(
          document.querySelectorAll("[data-coda-playlist-identity-return]"),
        ).toHaveLength(snapshot.afterReturn ? 1 : 0);
        expect(
          document.querySelectorAll("[data-coda-playlist-title-return]"),
        ).toHaveLength(snapshot.afterTitleReturn ? 1 : 0);
        snapshot.afterScrollTop = document.querySelector<HTMLElement>(
          "[data-coda-library-scroll]",
        )?.scrollTop;
        snapshots.push(snapshot);
      });
      return { finished };
    },
    );
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    try {
      const { queryClient } = renderSavedLibraryRoute({
        initialEntry: "/playlists",
      });
      await screen.findByRole("link", { name: /Night drive/ });
      const scrollRoot = document.querySelector<HTMLElement>(
        "[data-coda-library-scroll]",
      );
      if (!scrollRoot) throw new Error("Expected saved-library scroll root");
      scrollRoot.scrollTop = 173;
      queryClient.setQueryData(["bandcamp", "playlists", summary.id], detail);

      fireEvent.click(screen.getByRole("link", { name: /Night drive/ }));

      expect(startViewTransition).toHaveBeenCalledOnce();
      expect(
        await screen.findByRole("heading", { name: "Night drive" }),
      ).toBeInTheDocument();
      expect(
        document.querySelector("[data-coda-playlist-detail-surface]"),
      ).not.toContainElement(screen.getByRole("button", { name: "Back" }));
      await waitFor(() => expect(snapshots).toHaveLength(1));

      fireEvent.click(screen.getByRole("button", { name: "Back" }));

      expect(startViewTransition).toHaveBeenCalledTimes(2);
      await waitFor(() => expect(snapshots).toHaveLength(2));
      const restoredPlaylist = await screen.findByRole("link", {
        name: /Night drive/,
      });
      await waitFor(() => expect(restoredPlaylist).toHaveFocus());
      expect(snapshots).toEqual([
        {
          className: expect.stringContaining(
            "coda-transition--playlist-detail",
          ),
          beforeDetail: undefined,
          beforeSource: summary.id,
          beforeTitleDetail: undefined,
          beforeTitleSource: summary.id,
          beforeTitleSourceIsStatic: true,
          afterDetail: summary.id,
          afterReturn: undefined,
          afterTitleDetail: summary.id,
          afterTitleReturn: undefined,
          afterTitleReturnIsStatic: false,
          afterScrollTop: 0,
          identityAndTitleAreSeparate: true,
        },
        {
          className: expect.stringContaining(
            "coda-transition--playlist-detail-close",
          ),
          beforeDetail: summary.id,
          beforeSource: undefined,
          beforeTitleDetail: summary.id,
          beforeTitleSource: undefined,
          beforeTitleSourceIsStatic: false,
          afterDetail: undefined,
          afterReturn: summary.id,
          afterTitleDetail: undefined,
          afterTitleReturn: summary.id,
          afterTitleReturnIsStatic: true,
          afterScrollTop: 173,
          identityAndTitleAreSeparate: true,
        },
      ]);
      await waitFor(() =>
        expect(
          document.querySelectorAll(
            "[data-coda-playlist-identity-return], [data-coda-playlist-title-return]",
          ),
        ).toHaveLength(0),
      );
    } finally {
      vi.unstubAllEnvs();
      document.documentElement.classList.remove(
        "coda-transition--playlist-detail",
        "coda-transition--playlist-detail-close",
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

  it("keeps the icon pair when Back starts while the playlist name is being edited", async () => {
    const returnSnapshot: PlaylistReturnSnapshot = {};
    let transitionCount = 0;
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "startViewTransition",
    );
    const startViewTransition = vi.fn((update: () => void | Promise<void>) => {
      const currentTransition = ++transitionCount;
      if (currentTransition === 2) {
        returnSnapshot.beforeIcon = document.querySelector<HTMLElement>(
          "[data-coda-playlist-identity-detail]",
        )?.dataset.codaPlaylistIdentityDetail;
        returnSnapshot.beforeTitle = document.querySelector<HTMLElement>(
          "[data-coda-playlist-title-detail]",
        )?.dataset.codaPlaylistTitleDetail;
      }
      const finished = Promise.resolve(update()).then(() => {
        if (currentTransition === 2) {
          returnSnapshot.afterIcon = document.querySelector<HTMLElement>(
            "[data-coda-playlist-identity-return]",
          )?.dataset.codaPlaylistIdentityReturn;
          returnSnapshot.afterTitle = document.querySelector<HTMLElement>(
            "[data-coda-playlist-title-return]",
          )?.dataset.codaPlaylistTitleReturn;
        }
      });
      return { finished };
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    try {
      const { queryClient } = renderSavedLibraryRoute({
        initialEntry: "/playlists",
      });
      await screen.findByRole("link", { name: /Night drive/ });
      queryClient.setQueryData(["bandcamp", "playlists", summary.id], detail);

      fireEvent.click(screen.getByRole("link", { name: /Night drive/ }));
      fireEvent.click(
        await screen.findByRole("button", {
          name: `Rename ${summary.name}`,
        }),
      );
      expect(
        screen.getByRole("textbox", { name: "Playlist name" }),
      ).toBeInTheDocument();
      expect(
        document.querySelector("[data-coda-playlist-title-detail]"),
      ).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Back" }));

      await waitFor(() =>
        expect(returnSnapshot.afterIcon).toBe(summary.id),
      );
      expect(returnSnapshot).toEqual({
        beforeIcon: summary.id,
        beforeTitle: undefined,
        afterIcon: summary.id,
        afterTitle: summary.id,
      });
      await waitFor(() =>
        expect(
          document.querySelectorAll(
            "[data-coda-playlist-identity-return], [data-coda-playlist-title-return]",
          ),
        ).toHaveLength(0),
      );
    } finally {
      vi.unstubAllEnvs();
      document.documentElement.classList.remove(
        "coda-transition--playlist-detail",
        "coda-transition--playlist-detail-close",
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
});
