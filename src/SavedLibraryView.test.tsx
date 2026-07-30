import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CodaMotionProvider } from "./MotionProvider";
import type {
  LocalFavoriteCollection,
  PlaylistDetail,
  PlaylistSummary,
  Track,
} from "./types";

const mocks = vi.hoisted(() => ({
  createPlaylist: vi.fn(),
  deletePlaylist: vi.fn(),
  fetchCoverUrl: vi.fn(),
  fetchPlaylist: vi.fn(),
  fetchPlaylists: vi.fn(),
  invalidateCoverUrl: vi.fn(),
  updatePlaylist: vi.fn(),
}));

vi.mock("./lib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib")>();
  return {
    ...actual,
    createPlaylist: mocks.createPlaylist,
    deletePlaylist: mocks.deletePlaylist,
    fetchCoverUrl: mocks.fetchCoverUrl,
    fetchPlaylist: mocks.fetchPlaylist,
    fetchPlaylists: mocks.fetchPlaylists,
    invalidateCoverUrl: mocks.invalidateCoverUrl,
    updatePlaylist: mocks.updatePlaylist,
  };
});

import SavedLibraryView, { AddToPlaylistDialog } from "./SavedLibraryView";

const track: Track = {
  id: "song-1",
  title: "Mirage",
  artist: "Sweeps",
  album: "Mirage",
  albumId: "album-1",
  duration: 188,
  track: 1,
  palette: ["#a66", "#222"],
};

const secondTrack: Track = {
  ...track,
  id: "song-2",
  title: "Lanterns",
  duration: 204,
  track: 2,
};

const summary: PlaylistSummary = {
  id: "playlist-1",
  name: "Night drive",
  songCount: 1,
  duration: 188,
};

const detail: PlaylistDetail = {
  ...summary,
  tracks: [track],
};

const otherSummary: PlaylistSummary = {
  id: "playlist-2",
  name: "Sunday morning",
  songCount: 2,
  duration: 392,
};

const favorites: LocalFavoriteCollection = {
  albumIds: ["album-1"],
  songIds: ["song-1"],
  albums: [{
    id: "album-1",
    title: "Mirage",
    artist: "Sweeps",
    songCount: 1,
    duration: 188,
    palette: ["#a66", "#222"],
  }],
  tracks: [track],
  radioShowIds: [979],
  radioShows: [{
    id: 979,
    subtitle: "The Hip Hop Show",
    description: "New independent hip-hop.",
    publishedAt: "24 Jul 2026 00:00:00 GMT",
    series: {
      id: 5,
      title: "The Hip Hop Show",
      slug: "the-hip-hop-show",
    },
  }],
};

function withQueryClient(node: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return {
    ...render(
      <CodaMotionProvider>
        <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>
      </CodaMotionProvider>,
    ),
    queryClient,
  };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function AddDialogHarness({
  onNotify = vi.fn(),
}: {
  onNotify?: (message: string, tone?: "good" | "bad") => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Add selected to playlist
      </button>
      {open ? (
        <AddToPlaylistDialog
          tracks={[track]}
          onClose={() => setOpen(false)}
          onNotify={onNotify}
        />
      ) : null}
    </>
  );
}

const commonProps = {
  connected: true,
  favorites,
  favoritesLoading: false,
  favoritesLocal: true,
  onRefreshFavorites: vi.fn(),
  onToggleFavorite: vi.fn(),
  onToggleRadioFavorite: vi.fn(),
  playing: false,
  onTogglePlayback: vi.fn(),
  onPlayTracks: vi.fn(),
  onQueueTracks: vi.fn(),
  onPlayTrack: vi.fn(),
  onQueueTrack: vi.fn(),
  onOpenAlbum: vi.fn(),
  onOpenTrackAlbum: vi.fn(),
  onOpenArtist: vi.fn(),
  onOpenRadioShow: vi.fn(),
  onOpenRadioSeries: vi.fn(),
  onAddToPlaylist: vi.fn(),
  onNotify: vi.fn(),
};

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.fetchPlaylists.mockResolvedValue([summary]);
  mocks.fetchPlaylist.mockResolvedValue(detail);
  mocks.fetchCoverUrl.mockResolvedValue("https://bandcamp.com/cover.jpg");
  mocks.createPlaylist.mockResolvedValue(detail);
  mocks.updatePlaylist.mockResolvedValue(detail);
  mocks.deletePlaylist.mockResolvedValue(undefined);
  Object.values(commonProps).forEach((value) => {
    if (typeof value === "function" && "mockClear" in value) value.mockClear();
  });
});

describe("saved Bandcamp library views", () => {
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
      withQueryClient(<SavedLibraryView mode="playlists" {...commonProps} />);

      const playlistButton = await screen.findByRole("button", {
        name: /Night drive/,
      });
      fireEvent.click(playlistButton);

      expect(startViewTransition).not.toHaveBeenCalled();
      expect(screen.getByText("Loading playlist")).toBeInTheDocument();
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

  it("keeps Back instant when a playlist opened without a warm identity snapshot", async () => {
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
      withQueryClient(<SavedLibraryView mode="playlists" {...commonProps} />);

      fireEvent.click(await screen.findByRole("button", {
        name: /Night drive/,
      }));
      expect(await screen.findByRole("heading", { name: "Night drive" }))
        .toBeInTheDocument();
      expect(startViewTransition).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "All playlists" }));

      expect(startViewTransition).not.toHaveBeenCalled();
      expect(await screen.findByRole("button", { name: /Night drive/ }))
        .toBeInTheDocument();
      expect(
        document.querySelector("[data-coda-playlist-identity-return]"),
      ).not.toBeInTheDocument();
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

  it("pairs a warm playlist identity with its detail and returning row", async () => {
    vi.stubEnv("VITE_CODA_MOTION_VIEW_TRANSITIONS", "0");
    mocks.fetchPlaylists.mockResolvedValueOnce([summary, otherSummary]);
    const snapshots: Array<{
      className: string;
      beforeDetail?: string;
      beforeSource?: string;
      beforeTitleDetail?: string;
      beforeTitleSource?: string;
      afterDetail?: string;
      afterReturn?: string;
      afterTitleDetail?: string;
      afterTitleReturn?: string;
      afterFocusedPlaylist?: string;
      afterScrollTop?: number;
      identityAndTitleAreSeparate?: boolean;
    }> = [];
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "startViewTransition",
    );
    const startViewTransition = vi.fn((update: () => void) => {
      const snapshot = {
        className: document.documentElement.className,
        beforeDetail: document
          .querySelector<HTMLElement>(
            "[data-coda-playlist-identity-detail]",
          )
          ?.dataset.codaPlaylistIdentityDetail,
        beforeSource: document
          .querySelector<HTMLElement>(
            "[data-coda-playlist-identity-source]",
          )
          ?.dataset.codaPlaylistIdentitySource,
        beforeTitleDetail: document
          .querySelector<HTMLElement>(
            "[data-coda-playlist-title-detail]",
          )
          ?.dataset.codaPlaylistTitleDetail,
        beforeTitleSource: document
          .querySelector<HTMLElement>(
            "[data-coda-playlist-title-source]",
          )
          ?.dataset.codaPlaylistTitleSource,
        beforeTitleSourceIsStatic:
          document.querySelector(
            "[data-coda-playlist-title-source]",
          )?.matches('[data-slot="overflow-marquee-text"]') ?? false,
        afterDetail: undefined as string | undefined,
        afterReturn: undefined as string | undefined,
        afterTitleDetail: undefined as string | undefined,
        afterTitleReturn: undefined as string | undefined,
        afterTitleReturnIsStatic: false,
        afterFocusedPlaylist: undefined as string | undefined,
        afterScrollTop: undefined as number | undefined,
        identityAndTitleAreSeparate: undefined as boolean | undefined,
      };
      expect(document.querySelectorAll(
        "[data-coda-playlist-identity-source]",
      )).toHaveLength(snapshot.beforeSource ? 1 : 0);
      expect(document.querySelectorAll(
        "[data-coda-playlist-title-source]",
      )).toHaveLength(snapshot.beforeTitleSource ? 1 : 0);
      update();
      snapshot.afterDetail = document
        .querySelector<HTMLElement>(
          "[data-coda-playlist-identity-detail]",
        )
        ?.dataset.codaPlaylistIdentityDetail;
      snapshot.afterReturn = document
        .querySelector<HTMLElement>(
          "[data-coda-playlist-identity-return]",
        )
        ?.dataset.codaPlaylistIdentityReturn;
      snapshot.afterTitleDetail = document
        .querySelector<HTMLElement>(
          "[data-coda-playlist-title-detail]",
        )
        ?.dataset.codaPlaylistTitleDetail;
      snapshot.afterTitleReturn = document
        .querySelector<HTMLElement>(
          "[data-coda-playlist-title-return]",
        )
        ?.dataset.codaPlaylistTitleReturn;
      snapshot.afterTitleReturnIsStatic =
        document.querySelector(
          "[data-coda-playlist-title-return]",
        )?.matches('[data-slot="overflow-marquee-text"]') ?? false;
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
      expect(document.querySelectorAll(
        "[data-coda-playlist-identity-return]",
      )).toHaveLength(snapshot.afterReturn ? 1 : 0);
      expect(document.querySelectorAll(
        "[data-coda-playlist-title-return]",
      )).toHaveLength(snapshot.afterTitleReturn ? 1 : 0);
      snapshot.afterFocusedPlaylist =
        document.activeElement instanceof HTMLElement
          ? document.activeElement.dataset.playlistOpen
          : undefined;
      snapshot.afterScrollTop = document
        .querySelector<HTMLElement>("[data-coda-library-scroll]")
        ?.scrollTop;
      snapshots.push(snapshot);
      return { finished: Promise.resolve() };
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    try {
      const { queryClient } = withQueryClient(
        <div data-coda-library-scroll>
          <SavedLibraryView mode="playlists" {...commonProps} />
        </div>,
      );
      await screen.findByRole("button", { name: /Night drive/ });
      const scrollRoot = document.querySelector<HTMLElement>(
        "[data-coda-library-scroll]",
      );
      expect(scrollRoot).toBeInTheDocument();
      scrollRoot!.scrollTop = 173;
      queryClient.setQueryData(
        ["bandcamp", "playlists", summary.id],
        detail,
      );

      fireEvent.click(screen.getByRole("button", { name: /Night drive/ }));

      expect(startViewTransition).toHaveBeenCalledOnce();
      expect(screen.getByRole("heading", { name: "Night drive" }))
        .toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "All playlists" }));

      expect(startViewTransition).toHaveBeenCalledTimes(2);
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
          afterFocusedPlaylist: undefined,
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
          afterFocusedPlaylist: summary.id,
          afterScrollTop: 173,
          identityAndTitleAreSeparate: true,
        },
      ]);
      await waitFor(() =>
        expect(document.querySelectorAll(
          "[data-coda-playlist-identity-return], [data-coda-playlist-title-return]",
        )).toHaveLength(0)
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
    vi.stubEnv("VITE_CODA_MOTION_VIEW_TRANSITIONS", "0");
    const returnSnapshot: {
      beforeIcon?: string;
      beforeTitle?: string;
      afterIcon?: string;
      afterTitle?: string;
    } = {};
    let transitionCount = 0;
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "startViewTransition",
    );
    const startViewTransition = vi.fn((update: () => void) => {
      transitionCount += 1;
      if (transitionCount === 2) {
        returnSnapshot.beforeIcon = document
          .querySelector<HTMLElement>(
            "[data-coda-playlist-identity-detail]",
          )
          ?.dataset.codaPlaylistIdentityDetail;
        returnSnapshot.beforeTitle = document
          .querySelector<HTMLElement>(
            "[data-coda-playlist-title-detail]",
          )
          ?.dataset.codaPlaylistTitleDetail;
      }
      update();
      if (transitionCount === 2) {
        returnSnapshot.afterIcon = document
          .querySelector<HTMLElement>(
            "[data-coda-playlist-identity-return]",
          )
          ?.dataset.codaPlaylistIdentityReturn;
        returnSnapshot.afterTitle = document
          .querySelector<HTMLElement>(
            "[data-coda-playlist-title-return]",
          )
          ?.dataset.codaPlaylistTitleReturn;
      }
      return { finished: Promise.resolve() };
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    try {
      const { queryClient } = withQueryClient(
        <SavedLibraryView mode="playlists" {...commonProps} />,
      );
      await screen.findByRole("button", { name: /Night drive/ });
      queryClient.setQueryData(
        ["bandcamp", "playlists", summary.id],
        detail,
      );

      fireEvent.click(screen.getByRole("button", { name: /Night drive/ }));
      fireEvent.click(await screen.findByRole("button", {
        name: `Rename ${summary.name}`,
      }));
      expect(screen.getByRole("textbox", { name: "Playlist name" }))
        .toBeInTheDocument();
      expect(
        document.querySelector("[data-coda-playlist-title-detail]"),
      ).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "All playlists" }));

      expect(returnSnapshot).toEqual({
        beforeIcon: summary.id,
        beforeTitle: undefined,
        afterIcon: summary.id,
        afterTitle: summary.id,
      });
      await waitFor(() =>
        expect(document.querySelectorAll(
          "[data-coda-playlist-identity-return], [data-coda-playlist-title-return]",
        )).toHaveLength(0)
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

  it("opens a synced playlist and exposes playback and editing actions", async () => {
    withQueryClient(<SavedLibraryView mode="playlists" {...commonProps} />);

    expect(await screen.findByText("Create a playlist")).toBeInTheDocument();
    expect(screen.getByText("New playlist")).toBeInTheDocument();
    expect(
      screen.getByText("Playlists sync with your Bandcamp collection."),
    ).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: /Night drive/ }));
    const playlistHeading = await screen.findByRole("heading", {
      name: "Night drive",
    });
    expect(playlistHeading).toBeInTheDocument();
    expect(document.querySelector("[data-coda-playlist-metadata-detail]"))
      .toHaveAttribute("data-coda-playlist-metadata-detail", summary.id);
    expect(within(playlistHeading).getByText(summary.name)).toHaveAttribute(
      "data-coda-playlist-title-detail",
      summary.id,
    );
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(commonProps.onPlayTracks).toHaveBeenCalledWith([track]);
    const playlistTracks = screen.getByLabelText("Night drive tracks");
    expect(within(playlistTracks).getByRole("listitem")).toHaveClass(
      "h-16",
      "py-3",
      "after:absolute",
      "grid-cols-[2rem_2.5rem_minmax(0,1fr)_3rem_repeat(2,2rem)]",
      "lg:grid-cols-[2rem_2.5rem_minmax(0,1fr)_4rem_repeat(2,2rem)]",
    );
    expect(within(playlistTracks).getByRole("listitem")).not.toHaveClass(
      "border-b",
    );
    expect(within(playlistTracks).getByRole("listitem")).not.toHaveClass(
      "h-14",
    );
    fireEvent.click(within(playlistTracks).getByRole("button", { name: "Sweeps" }));
    expect(commonProps.onOpenArtist).toHaveBeenCalledWith(
      "Sweeps",
      "album-1",
      track,
    );
    const playlistAlbumButton = within(playlistTracks).getByRole("button", {
      name: "Open Mirage album",
    });
    fireEvent.click(playlistAlbumButton);
    expect(commonProps.onOpenTrackAlbum).toHaveBeenCalledWith(
      track,
      playlistAlbumButton,
    );

    fireEvent.click(screen.getByRole("button", { name: "Rename Night drive" }));
    fireEvent.change(screen.getByLabelText("Playlist name"), { target: { value: "After hours" } });
    fireEvent.click(screen.getByRole("button", { name: "Save playlist name" }));
    await waitFor(() =>
      expect(mocks.updatePlaylist.mock.calls[0]?.[0]).toEqual({
        playlistId: "playlist-1",
        name: "After hours",
      }),
    );
  });

  it("uses the first track artwork when Bandcamp omits a playlist cover", async () => {
    mocks.fetchPlaylist.mockResolvedValueOnce({
      ...detail,
      tracks: [{ ...track, coverArt: "first-track-cover" }],
    });
    const { container } = withQueryClient(
      <SavedLibraryView mode="playlists" {...commonProps} />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Night drive/ }));

    await waitFor(() =>
      expect(mocks.fetchCoverUrl).toHaveBeenCalledWith("first-track-cover"),
    );
    expect(container.querySelector("header img")).toHaveAttribute(
      "src",
      "https://bandcamp.com/cover.jpg",
    );
  });

  it("clears replaced playlist artwork while the next first-track cover loads", async () => {
    const nextCover = deferred<string>();
    mocks.fetchCoverUrl
      .mockReset()
      .mockImplementation((coverArtId: string) =>
        coverArtId === "first-track-cover"
          ? Promise.resolve("https://bandcamp.com/first-cover.jpg")
          : nextCover.promise
      );
    mocks.fetchPlaylist.mockResolvedValueOnce({
      ...detail,
      tracks: [{ ...track, coverArt: "first-track-cover" }],
    });
    const { container, queryClient } = withQueryClient(
      <SavedLibraryView mode="playlists" {...commonProps} />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Night drive/ }));
    await waitFor(() =>
      expect(container.querySelector("header img")).toHaveAttribute(
        "src",
        "https://bandcamp.com/first-cover.jpg",
      ),
    );

    act(() => {
      queryClient.setQueryData(
        ["bandcamp", "playlists", "playlist-1"],
        {
          ...detail,
          tracks: [{ ...track, id: "song-2", coverArt: "next-track-cover" }],
        },
      );
    });
    await waitFor(() =>
      expect(container.querySelector("header img")).not.toBeInTheDocument(),
    );

    await act(async () => {
      nextCover.resolve("https://bandcamp.com/next-cover.jpg");
      await nextCover.promise;
    });
    await waitFor(() =>
      expect(container.querySelector("header img")).toHaveAttribute(
        "src",
        "https://bandcamp.com/next-cover.jpg",
      ),
    );
  });

  it("invalidates and retries a broken playlist cover once", async () => {
    let invalidated = false;
    mocks.fetchCoverUrl
      .mockReset()
      .mockImplementation(() =>
        Promise.resolve(
          invalidated
            ? "https://bandcamp.com/refreshed-cover.jpg"
            : "https://bandcamp.com/expired-cover.jpg",
        )
      );
    mocks.invalidateCoverUrl.mockImplementation(() => {
      invalidated = true;
    });
    mocks.fetchPlaylist.mockResolvedValueOnce({
      ...detail,
      tracks: [{ ...track, coverArt: "first-track-cover" }],
    });
    const { container } = withQueryClient(
      <SavedLibraryView mode="playlists" {...commonProps} />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Night drive/ }));
    const expired = await waitFor(() => {
      const image = container.querySelector<HTMLImageElement>("header img");
      if (!image) throw new Error("Expected playlist artwork");
      expect(image).toHaveAttribute(
        "src",
        "https://bandcamp.com/expired-cover.jpg",
      );
      return image;
    });
    fireEvent.error(expired);

    await waitFor(() =>
      expect(mocks.invalidateCoverUrl).toHaveBeenCalledWith(
        "first-track-cover",
      ),
    );
    await waitFor(() =>
      expect(container.querySelector("header img")).toHaveAttribute(
        "src",
        "https://bandcamp.com/refreshed-cover.jpg",
      ),
    );
    expect(mocks.invalidateCoverUrl).toHaveBeenCalledOnce();
  });

  it("moves focus into playlist details and restores the opening row on Back", async () => {
    withQueryClient(<SavedLibraryView mode="playlists" {...commonProps} />);

    const playlistButton = await screen.findByRole("button", {
      name: /Night drive/,
    });
    playlistButton.focus();
    fireEvent.click(playlistButton);

    const heading = await screen.findByRole("heading", {
      name: "Night drive",
    });
    await waitFor(() => expect(heading).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "All playlists" }));

    const restoredPlaylistButton = await screen.findByRole("button", {
      name: /Night drive/,
    });
    await waitFor(() => expect(restoredPlaylistButton).toHaveFocus());
  });

  it("creates a playlist with selected tracks from the add dialog", async () => {
    const onClose = vi.fn();
    const onNotify = vi.fn();
    withQueryClient(
      <AddToPlaylistDialog tracks={[track]} onClose={onClose} onNotify={onNotify} />,
    );

    fireEvent.change(screen.getByLabelText("New playlist name"), {
      target: { value: "Fresh finds" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(mocks.createPlaylist).toHaveBeenCalledWith("Fresh finds", ["song-1"]),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("focuses the add form and restores its opener after idle dismissal", async () => {
    const user = userEvent.setup();
    withQueryClient(<AddDialogHarness />);

    const trigger = screen.getByRole("button", {
      name: "Add selected to playlist",
    });
    await user.click(trigger);
    await waitFor(() =>
      expect(screen.getByLabelText("New playlist name")).toHaveFocus(),
    );

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Add to playlist" }))
        .not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    fireEvent.pointerDown(document.body);
    fireEvent.mouseDown(document.body);
    fireEvent.click(document.body);
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Add to playlist" }))
        .not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });

  it("rejects Escape and backdrop dismissal while an add mutation is pending", async () => {
    const user = userEvent.setup();
    const pendingCreate = deferred<PlaylistDetail>();
    mocks.createPlaylist.mockReturnValue(pendingCreate.promise);
    withQueryClient(<AddDialogHarness />);

    await user.click(screen.getByRole("button", {
      name: "Add selected to playlist",
    }));
    await user.type(screen.getByLabelText("New playlist name"), "Fresh finds");
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByRole("button", { name: "Creating…" }))
      .toBeDisabled();

    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Add to playlist" }))
      .toBeVisible();
    fireEvent.pointerDown(document.body);
    fireEvent.mouseDown(document.body);
    fireEvent.click(document.body);
    expect(screen.getByRole("dialog", { name: "Add to playlist" }))
      .toBeVisible();
    expect(mocks.createPlaylist).toHaveBeenCalledTimes(1);

    pendingCreate.resolve(detail);
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Add to playlist" }))
        .not.toBeInTheDocument(),
    );
  });

  it("shows a newly created playlist immediately and removes it on failure", async () => {
    const pendingCreate = deferred<PlaylistDetail>();
    mocks.createPlaylist.mockReturnValue(pendingCreate.promise);
    withQueryClient(<SavedLibraryView mode="playlists" {...commonProps} />);

    await screen.findByText("Create a playlist");
    fireEvent.change(screen.getByPlaceholderText("Late-night rotation"), {
      target: { value: "Fresh finds" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByRole("button", { name: /Fresh finds/ }))
      .toBeInTheDocument();
    pendingCreate.reject(new Error("Create failed"));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Fresh finds/ }))
        .not.toBeInTheDocument(),
    );
    expect(commonProps.onNotify).toHaveBeenCalledWith("Create failed", "bad");
  });

  it("optimistically renames a playlist and restores its name on failure", async () => {
    const pendingUpdate = deferred<PlaylistDetail>();
    mocks.updatePlaylist.mockReturnValue(pendingUpdate.promise);
    withQueryClient(<SavedLibraryView mode="playlists" {...commonProps} />);

    fireEvent.click(await screen.findByRole("button", { name: /Night drive/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Rename Night drive" }));
    fireEvent.change(screen.getByLabelText("Playlist name"), {
      target: { value: "After hours" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save playlist name" }));

    expect(await screen.findByRole("heading", { name: "After hours" }))
      .toBeInTheDocument();
    pendingUpdate.reject(new Error("Rename failed"));

    expect(await screen.findByRole("heading", { name: "Night drive" }))
      .toBeInTheDocument();
    expect(commonProps.onNotify).toHaveBeenCalledWith("Rename failed", "bad");
  });

  it("optimistically removes a playlist track and rolls it back on failure", async () => {
    const twoTrackDetail: PlaylistDetail = {
      ...detail,
      duration: track.duration + secondTrack.duration,
      songCount: 2,
      tracks: [track, secondTrack],
    };
    const pendingUpdate = deferred<PlaylistDetail>();
    mocks.fetchPlaylist.mockResolvedValue(twoTrackDetail);
    mocks.updatePlaylist.mockReturnValue(pendingUpdate.promise);
    withQueryClient(<SavedLibraryView mode="playlists" {...commonProps} />);

    fireEvent.click(await screen.findByRole("button", { name: /Night drive/ }));
    const remove = await screen.findByRole("button", {
      name: "Remove Lanterns from Night drive",
    });
    fireEvent.click(remove);
    await waitFor(() =>
      expect(screen.queryByText("Lanterns")).not.toBeInTheDocument(),
    );

    pendingUpdate.reject(new Error("Remove failed"));
    expect(await screen.findByText("Lanterns")).toBeInTheDocument();
    expect(commonProps.onNotify).toHaveBeenCalledWith("Remove failed", "bad");
  });

  it("keeps a committed optimistic removal when playlist revalidation fails", async () => {
    const twoTrackDetail: PlaylistDetail = {
      ...detail,
      duration: track.duration + secondTrack.duration,
      songCount: 2,
      tracks: [track, secondTrack],
    };
    mocks.fetchPlaylist
      .mockResolvedValueOnce(twoTrackDetail)
      .mockRejectedValueOnce(new Error("Refresh failed"));
    mocks.updatePlaylist.mockResolvedValueOnce(undefined);
    withQueryClient(<SavedLibraryView mode="playlists" {...commonProps} />);

    fireEvent.click(await screen.findByRole("button", { name: /Night drive/ }));
    fireEvent.click(await screen.findByRole("button", {
      name: "Remove Lanterns from Night drive",
    }));

    await waitFor(() =>
      expect(screen.queryByText("Lanterns")).not.toBeInTheDocument()
    );
    await waitFor(() => expect(mocks.fetchPlaylist).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Lanterns")).not.toBeInTheDocument();
    expect(commonProps.onNotify).not.toHaveBeenCalledWith(
      "Refresh failed",
      "bad",
    );
  });

  it("keeps deletion confirmation open while pending and retryable after failure", async () => {
    const user = userEvent.setup();
    const pendingDelete = deferred<void>();
    mocks.deletePlaylist.mockReturnValue(pendingDelete.promise);
    const { queryClient } = withQueryClient(
      <SavedLibraryView mode="playlists" {...commonProps} />,
    );

    await user.click(await screen.findByRole("button", { name: /Night drive/ }));
    const deleteTrigger = await screen.findByRole("button", {
      name: "Delete playlist",
    });
    await user.click(deleteTrigger);
    const deleteDialog = screen.getByRole("alertdialog", {
      name: "Delete Night drive?",
    });
    await waitFor(() => expect(deleteDialog).toBeVisible());

    await user.keyboard("{Escape}");
    expect(deleteDialog).toBeVisible();
    expect(mocks.deletePlaylist).not.toHaveBeenCalled();

    fireEvent.pointerDown(document.body);
    fireEvent.mouseDown(document.body);
    fireEvent.click(document.body);
    expect(deleteDialog).toBeVisible();
    expect(mocks.deletePlaylist).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Keep playlist" }));
    expect(mocks.deletePlaylist).not.toHaveBeenCalled();
    await waitFor(() => expect(deleteTrigger).toHaveFocus());

    await user.click(deleteTrigger);
    await user.click(screen.getByRole("button", {
      name: "Delete playlist from Bandcamp",
    }));
    expect(mocks.deletePlaylist).toHaveBeenCalledTimes(1);
    expect(mocks.deletePlaylist.mock.calls[0]?.[0]).toBe("playlist-1");

    await waitFor(() =>
      expect(queryClient.getQueryData<PlaylistSummary[]>(["bandcamp", "playlists"]))
        .toEqual([]),
    );
    expect(screen.getByRole("alertdialog", {
      name: "Delete Night drive?",
    })).toBeVisible();
    expect(screen.getByRole("button", {
      name: "Delete playlist from Bandcamp",
    })).toBeDisabled();
    expect(screen.getByText("Deleting…")).toBeInTheDocument();
    pendingDelete.reject(new Error("Delete failed"));

    await waitFor(() =>
      expect(queryClient.getQueryData<PlaylistSummary[]>(["bandcamp", "playlists"]))
        .toEqual([summary]),
    );
    expect(screen.getByRole("alertdialog", {
      name: "Delete Night drive?",
    })).toBeVisible();
    expect(screen.getByRole("button", {
      name: "Delete playlist from Bandcamp",
    })).toBeEnabled();
    expect(commonProps.onNotify).toHaveBeenCalledWith("Delete failed", "bad");
  });

  it("optimistically updates Add-to-playlist counts and rolls back on failure", async () => {
    const pendingUpdate = deferred<PlaylistDetail>();
    mocks.updatePlaylist.mockReturnValue(pendingUpdate.promise);
    const onClose = vi.fn();
    const onNotify = vi.fn();
    withQueryClient(
      <AddToPlaylistDialog
        tracks={[secondTrack]}
        onClose={onClose}
        onNotify={onNotify}
      />,
    );

    const target = await screen.findByRole("button", { name: /Night drive/ });
    expect(within(target).getByText("1 track")).toBeInTheDocument();
    fireEvent.click(target);
    expect(await within(target).findByText("2 tracks")).toBeInTheDocument();

    pendingUpdate.reject(new Error("Add failed"));
    expect(await within(target).findByText("1 track")).toBeInTheDocument();
    expect(onNotify).toHaveBeenCalledWith("Add failed", "bad");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes Add to playlist with optimistic counts after a committed empty response", async () => {
    mocks.updatePlaylist.mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    const onNotify = vi.fn();
    const { queryClient } = withQueryClient(
      <AddToPlaylistDialog
        tracks={[secondTrack]}
        onClose={onClose}
        onNotify={onNotify}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Night drive/ }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(
      queryClient.getQueryData<PlaylistSummary[]>(["bandcamp", "playlists"]),
    ).toEqual([{
      ...summary,
      duration: summary.duration + secondTrack.duration,
      songCount: 2,
    }]);
    expect(onNotify).toHaveBeenCalledWith(
      "1 track added to Night drive",
      "good",
    );
  });

  it("renders favorites and removes a starred track through the supplied action", () => {
    withQueryClient(<SavedLibraryView mode="favorites" {...commonProps} />);

    const favoriteTracks = screen.getByLabelText("Favorite tracks");
    fireEvent.click(within(favoriteTracks).getByRole("button", { name: "Remove Mirage from favorites" }));
    expect(commonProps.onToggleFavorite).toHaveBeenCalledWith("song-1", "song", false);
    fireEvent.click(within(favoriteTracks).getByRole("button", { name: "Sweeps" }));
    expect(commonProps.onOpenArtist).toHaveBeenCalledWith(
      "Sweeps",
      "album-1",
      track,
    );
    const favoriteAlbumButton = within(favoriteTracks).getByRole("button", {
      name: "Open Mirage album",
    });
    fireEvent.click(favoriteAlbumButton);
    expect(commonProps.onOpenTrackAlbum).toHaveBeenCalledWith(
      track,
      favoriteAlbumButton,
    );
    fireEvent.click(screen.getByRole("button", {
      name: "Browse The Hip Hop Show",
    }));
    expect(commonProps.onOpenRadioSeries).toHaveBeenCalledWith(5);
    fireEvent.click(screen.getByRole("button", {
      name: "Open The Hip Hop Show details",
    }));
    expect(commonProps.onOpenRadioShow).toHaveBeenCalledWith(
      favorites.radioShows[0],
    );
    fireEvent.click(screen.getByRole("button", {
      name: "Remove The Hip Hop Show from favorites",
    }));
    expect(commonProps.onToggleRadioFavorite).toHaveBeenCalledWith(
      favorites.radioShows[0],
      false,
    );
  });

  it("marks every saved-library album destination busy while its album opens", async () => {
    const favoriteView = withQueryClient(
      <SavedLibraryView
        mode="favorites"
        {...commonProps}
        loadingAlbumId="album-1"
      />,
    );

    const releases = screen.getByRole("heading", { name: "Releases" })
      .closest("section");
    if (!releases) throw new Error("Expected a releases section");
    const artworkButton = within(releases).getByRole("button", {
      name: "Open Mirage",
    });
    const titleButton = within(releases).getByRole("button", {
      name: "Mirage",
    });

    expect(artworkButton).toBeDisabled();
    expect(artworkButton).toHaveAttribute("aria-busy", "true");
    expect(within(artworkButton).getByRole("status", {
      name: "Loading Mirage artwork",
    })).toBeInTheDocument();
    expect(titleButton).toBeDisabled();
    expect(titleButton).toHaveAttribute("aria-busy", "true");
    expect(within(titleButton).getByRole("status", {
      name: "Loading Mirage release",
    })).toBeInTheDocument();

    const favoriteTracks = screen.getByLabelText("Favorite tracks");
    const favoriteAlbumButton = within(favoriteTracks).getByRole("button", {
      name: "Open Mirage album",
    });

    expect(favoriteAlbumButton).toBeDisabled();
    expect(favoriteAlbumButton).toHaveAttribute("aria-busy", "true");
    expect(within(favoriteAlbumButton).getByRole("status", {
      name: "Loading Mirage album",
    })).toBeInTheDocument();
    favoriteView.unmount();

    withQueryClient(
      <SavedLibraryView
        mode="playlists"
        {...commonProps}
        loadingAlbumId="album-1"
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Night drive/ }));
    const playlistTracks = await screen.findByLabelText("Night drive tracks");
    const playlistAlbumButton = within(playlistTracks).getByRole("button", {
      name: "Open Mirage album",
    });

    expect(playlistAlbumButton).toBeDisabled();
    expect(playlistAlbumButton).toHaveAttribute("aria-busy", "true");
    expect(within(playlistAlbumButton).getByRole("status", {
      name: "Loading Mirage album",
    })).toBeInTheDocument();
  });

  it("matches playlist and track play controls to the current player state", async () => {
    const onTogglePlayback = vi.fn();
    withQueryClient(
      <SavedLibraryView
        mode="playlists"
        {...commonProps}
        currentTrackId="song-1"
        playing
        onTogglePlayback={onTogglePlayback}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Night drive/ }));
    expect(await screen.findByRole("button", { name: "Pause Night drive" }))
      .toHaveAttribute("aria-pressed", "true");
    const trackPause = screen.getByRole("button", { name: "Pause Mirage" });
    expect(trackPause).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(trackPause);
    expect(onTogglePlayback).toHaveBeenCalledOnce();
  });

  it("keeps virtualized playlist rows aligned to the 64px spacing contract", async () => {
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
        this.callback([{
          borderBoxSize: [{
            blockSize: bounds.height,
            inlineSize: bounds.width,
          }],
          contentRect: bounds,
          target,
        } as unknown as ResizeObserverEntry], this);
      }
      unobserve() {}
    }
    globalThis.ResizeObserver = ResizeObserverMock;
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
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
        id: `playlist-track-${index}`,
        title: `Playlist track ${index}`,
        track: index + 1,
      }));
      mocks.fetchPlaylist.mockResolvedValueOnce({
        ...detail,
        duration: tracks.reduce((total, item) => total + item.duration, 0),
        songCount: tracks.length,
        tracks,
      });
      withQueryClient(
        <div data-coda-library-scroll>
          <SavedLibraryView mode="playlists" {...commonProps} />
        </div>,
      );

      fireEvent.click(await screen.findByRole("button", { name: /Night drive/ }));
      const list = await screen.findByRole("list", {
        name: "Night drive tracks",
      });
      await waitFor(() => {
        const rows = within(list).getAllByRole("listitem");
        expect(rows.length).toBeGreaterThan(1);
        expect(rows.length).toBeLessThan(30);
      });
      expect(list).toHaveAttribute("data-virtualized", "true");
      const rows = within(list).getAllByRole("listitem")
        .sort(
          (left, right) =>
            Number(left.dataset.index) - Number(right.dataset.index),
        )
        .slice(0, 2);
      const rowOffset = (element: HTMLElement) => {
        const match = element.style.transform.match(/translateY\((-?\d+)px\)/);
        return Number(match?.[1]);
      };
      expect(rows[0]).toHaveStyle({ height: "64px" });
      expect(rows[1]).toHaveStyle({ height: "64px" });
      expect(rowOffset(rows[1]) - rowOffset(rows[0])).toBe(64);
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect;
      globalThis.ResizeObserver = originalResizeObserver;
    }
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
        this.callback([{
          borderBoxSize: [{
            blockSize: bounds.height,
            inlineSize: bounds.width,
          }],
          contentRect: bounds,
          target,
        } as unknown as ResizeObserverEntry], this);
      }
      unobserve() {}
    }
    globalThis.ResizeObserver = ResizeObserverMock;
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
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
      withQueryClient(
        <div data-coda-library-scroll>
          <SavedLibraryView
            mode="favorites"
            {...commonProps}
            currentTrackId={tracks[0].id}
            favorites={largeFavorites}
            onTogglePlayback={onTogglePlayback}
            playing
          />
        </div>,
      );

      const list = screen.getByRole("list", { name: "Favorite tracks" });
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
});
