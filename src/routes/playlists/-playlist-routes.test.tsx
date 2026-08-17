import { QueryClient } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createLibrarySessionController } from "@/features/library-session";
import { createCodaMemoryRouter } from "@/router";
import { parsePlaylistIdParam } from "@/routing/routeContracts";
import { mocks, renderApp } from "@/test/appTestHarness";
import type { PlaylistDetail, PlaylistSummary, Track } from "@/types";

const track: Track = {
  album: "Mirage",
  albumId: "album-1",
  artist: "Sweeps",
  duration: 188,
  id: "song-1",
  palette: ["#a66", "#222"],
  title: "Mirage",
  track: 1,
};

const summary: PlaylistSummary = {
  duration: 188,
  id: "playlist-1",
  name: "Night drive",
  songCount: 1,
};

const detail: PlaylistDetail = {
  ...summary,
  tracks: [track],
};

type TransitionSnapshot = {
  afterDetail?: string;
  afterReturn?: string;
  afterTitleReturn?: string;
  beforeDetail?: string;
  beforeSource?: string;
  className: string;
};

function renderPlaylistRoute(initialEntry = "/playlists") {
  const view = renderApp({
    connectedLibrary: [],
    initialEntries: [initialEntry],
  });
  view.queryClient.setQueryData(
    ["bandcamp", "playlists", summary.id],
    detail,
  );
  return view;
}

const originalStartViewTransition = Object.getOwnPropertyDescriptor(
  document,
  "startViewTransition",
);

beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  mocks.fetchPlaylist.mockReset().mockResolvedValue(detail);
  mocks.fetchPlaylists.mockReset().mockResolvedValue([summary]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  document.documentElement.classList.remove(
    "coda-transition--playlist-detail",
    "coda-transition--playlist-detail-close",
  );
  if (originalStartViewTransition) {
    Object.defineProperty(
      document,
      "startViewTransition",
      originalStartViewTransition,
    );
  } else {
    Reflect.deleteProperty(document, "startViewTransition");
  }
});

describe("Playlist file routes", () => {
  it.each(["checking", "disconnected"] as const)(
    "keeps %s authenticated route preload inert",
    async (connection) => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const librarySession = createLibrarySessionController({
        dependencies: {
          checkConnection: vi.fn(async () => false),
          clearRuntimeData: vi.fn(),
        },
        queryClient,
      });
      const deactivate =
        connection === "disconnected" ? librarySession.activate() : undefined;
      if (connection === "disconnected") {
        await waitFor(() => {
          expect(librarySession.route.getSnapshot().connection).toBe(
            "disconnected",
          );
        });
      }
      const router = createCodaMemoryRouter(
        queryClient,
        ["/collection?q=&genre=All&sort=recent&mode=releases"],
        librarySession,
      );
      await router.load();

      await router.preloadRoute({
        params: { playlistId: parsePlaylistIdParam(summary.id) },
        to: "/playlists/$playlistId",
      });

      expect(mocks.fetchPlaylists).not.toHaveBeenCalled();
      expect(mocks.fetchPlaylist).not.toHaveBeenCalled();
      expect(mocks.fetchStreamUrl).not.toHaveBeenCalled();
      deactivate?.();
    },
  );

  it("stops authenticated preload as soon as disconnect begins", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let finishDisconnect!: () => void;
    const disconnect = vi.fn(
      () =>
        new Promise<string | undefined>((resolve) => {
          finishDisconnect = () => resolve(undefined);
        }),
    );
    const librarySession = createLibrarySessionController({
      dependencies: { clearRuntimeData: vi.fn(), disconnect },
      queryClient,
    });
    librarySession.commands.acceptConnectedLibrary([], { announce: false });
    const disconnectRequest = librarySession.commands.disconnect();
    expect(librarySession.route.getSnapshot()).toMatchObject({
      canPreloadAuthenticatedRoute: false,
      connection: "connected",
    });
    const router = createCodaMemoryRouter(queryClient, ["/collection"], librarySession);
    await router.load();

    await router.preloadRoute({ to: "/playlists" });

    expect(mocks.fetchPlaylists).not.toHaveBeenCalled();
    finishDisconnect();
    await disconnectRequest;
  });

  it("preloads direct detail independently, then primes the list at its owning route", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const checkConnection = vi.fn(async () => true);
    const librarySession = createLibrarySessionController({
      dependencies: { checkConnection },
      queryClient,
    });
    librarySession.commands.acceptConnectedLibrary([], { announce: false });
    const router = createCodaMemoryRouter(queryClient, ["/collection"], librarySession);
    await router.load();
    const playlistId = parsePlaylistIdParam(summary.id);

    await router.preloadRoute({
      params: { playlistId },
      to: "/playlists/$playlistId",
    });

    expect(mocks.fetchPlaylists).not.toHaveBeenCalled();
    expect(mocks.fetchPlaylist).toHaveBeenCalledOnce();
    expect(checkConnection).not.toHaveBeenCalled();

    await router.navigate({
      params: { playlistId },
      to: "/playlists/$playlistId",
    });

    expect(mocks.fetchPlaylists).not.toHaveBeenCalled();
    expect(mocks.fetchPlaylist).toHaveBeenCalledOnce();
    expect(mocks.fetchStreamUrl).not.toHaveBeenCalled();

    await router.preloadRoute({ to: "/playlists" });

    expect(mocks.fetchPlaylists).toHaveBeenCalledOnce();
    expect(mocks.fetchPlaylist).toHaveBeenCalledOnce();
  });

  it("activates a typed playlist link from the keyboard without starting playback", async () => {
    const user = userEvent.setup();
    const { router } = renderPlaylistRoute();
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    play.mockClear();
    const playlistLink = await screen.findByRole("link", {
      name: /Night drive/u,
    });

    expect(playlistLink).toHaveAttribute("href", "/playlists/playlist-1");
    expect(playlistLink.querySelector("a, button")).toBeNull();

    playlistLink.focus();
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/playlists/playlist-1");
    });
    expect(mocks.fetchStreamUrl).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
  });

  it("restores the exact list trigger, scroll, and shared identity after detail Back", async () => {
    const snapshots: TransitionSnapshot[] = [];
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: vi.fn((update: () => void | Promise<void>) => {
        const snapshot: TransitionSnapshot = {
          beforeDetail: document.querySelector<HTMLElement>(
            "[data-coda-playlist-identity-detail]",
          )?.dataset.codaPlaylistIdentityDetail,
          beforeSource: document.querySelector<HTMLElement>(
            "[data-coda-playlist-identity-source]",
          )?.dataset.codaPlaylistIdentitySource,
          className: document.documentElement.className,
        };
        const updateCallbackDone = Promise.resolve(update()).then(() => {
          snapshot.afterDetail = document.querySelector<HTMLElement>(
            "[data-coda-playlist-identity-detail]",
          )?.dataset.codaPlaylistIdentityDetail;
          snapshot.afterReturn = document.querySelector<HTMLElement>(
            "[data-coda-playlist-identity-return]",
          )?.dataset.codaPlaylistIdentityReturn;
          snapshot.afterTitleReturn = document.querySelector<HTMLElement>(
            "[data-coda-playlist-title-return]",
          )?.dataset.codaPlaylistTitleReturn;
          snapshots.push(snapshot);
        });
        return {
          finished: updateCallbackDone,
          updateCallbackDone,
        };
      }),
    });

    const { router } = renderPlaylistRoute();
    const openPlaylist = await screen.findByRole("link", {
      name: /Night drive/u,
    });
    const scrollRoot = document.querySelector<HTMLElement>(
      "[data-coda-library-scroll]",
    );
    expect(scrollRoot).not.toBeNull();
    if (scrollRoot) scrollRoot.scrollTop = 173;

    expect(openPlaylist).toHaveAttribute("href", "/playlists/playlist-1");
    openPlaylist.focus();
    fireEvent.click(openPlaylist);

    expect(
      await screen.findByRole("heading", { name: summary.name }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/playlists/playlist-1");
    });

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    const restoredTrigger = await screen.findByRole("link", {
      name: /Night drive/u,
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/playlists");
      expect(restoredTrigger).toHaveFocus();
      expect(scrollRoot?.scrollTop).toBe(173);
    });

    expect(snapshots).toHaveLength(2);
    expect(snapshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          afterDetail: summary.id,
          beforeSource: summary.id,
          className: expect.stringContaining(
            "coda-transition--playlist-detail",
          ),
        }),
        expect.objectContaining({
          afterReturn: summary.id,
          afterTitleReturn: summary.id,
          beforeDetail: summary.id,
          className: expect.stringContaining(
            "coda-transition--playlist-detail-close",
          ),
        }),
      ]),
    );
    await waitFor(() => {
      expect(
        document.querySelectorAll(
          "[data-coda-playlist-identity-return], [data-coda-playlist-title-return]",
        ),
      ).toHaveLength(0);
    });
  });
});
