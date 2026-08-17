import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { hydrateTrack } from "@/lib";
import type { Track } from "@/types";
import {
  commonProps,
  detail,
  mocks,
  renderSavedLibraryRoute,
  resizeObserverEntry,
  secondTrack,
  summary,
  track,
} from "@/test/savedLibraryViewTestHarness";

describe("saved playlist surfaces", () => {
  it("opens a synced playlist and exposes playback and editing actions", async () => {
    const hydratedPlaylistTrack = hydrateTrack(track);
    renderSavedLibraryRoute({ initialEntry: "/playlists" });

    expect(await screen.findByText("Create a playlist")).toBeInTheDocument();
    expect(screen.getByText("New playlist")).toBeInTheDocument();
    expect(
      screen.getByText("Playlists sync with your Bandcamp collection."),
    ).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("link", { name: /Night drive/ }));
    const playlistHeading = await screen.findByRole("heading", {
      name: "Night drive",
    });
    expect(playlistHeading).toBeInTheDocument();
    expect(
      document.querySelector("[data-coda-playlist-metadata-detail]"),
    ).toHaveAttribute("data-coda-playlist-metadata-detail", summary.id);
    expect(within(playlistHeading).getByText(summary.name)).toHaveAttribute(
      "data-coda-playlist-title-detail",
      summary.id,
    );
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(commonProps.onPlayTracks).toHaveBeenCalledWith([
      hydratedPlaylistTrack,
    ]);
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
    const playlistArtistLink = within(playlistTracks).getByRole("link", {
      name: "Sweeps",
    });
    expect(playlistArtistLink).toHaveAttribute(
      "href",
      "/collection/artists/sweeps?q=&genre=All&sort=recent&mode=artists&albumId=album-1",
    );
    fireEvent.click(playlistArtistLink);
    expect(commonProps.onOpenArtist).toHaveBeenCalledWith(
      "Sweeps",
      "album-1",
      hydratedPlaylistTrack,
      expect.any(HTMLElement),
    );
    const playlistAlbumButton = within(playlistTracks)
      .getAllByRole("link", { name: "Open Mirage" })
      .find(
        (link) =>
          link.getAttribute("data-navigation-slot") === "playlist-track:song-1",
      );
    if (!playlistAlbumButton) throw new Error("Expected playlist album link");
    expect(playlistAlbumButton).toHaveAttribute(
      "href",
      "/collection/albums/album-1?q=&genre=All&sort=recent&mode=releases",
    );
    fireEvent.click(playlistAlbumButton);
    expect(commonProps.onOpenTrackAlbum).toHaveBeenCalledWith(
      hydratedPlaylistTrack,
      playlistAlbumButton,
    );

    fireEvent.click(screen.getByRole("button", { name: "Rename Night drive" }));
    fireEvent.change(screen.getByLabelText("Playlist name"), {
      target: { value: "After hours" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save playlist name" }));
    await waitFor(() =>
      expect(mocks.updatePlaylist.mock.calls[0]?.[0]).toEqual({
        playlistId: "playlist-1",
        name: "After hours",
        songIdsToAdd: [],
        songIndexesToRemove: [],
      }),
    );
  });

  it("names playlist album links uniquely when the album title is missing", async () => {
    mocks.fetchPlaylist.mockResolvedValueOnce({
      ...detail,
      duration: track.duration + secondTrack.duration,
      songCount: 2,
      tracks: [
        { ...track, album: "" },
        { ...secondTrack, album: "   " },
      ],
    });
    renderSavedLibraryRoute({ initialEntry: "/playlists" });

    fireEvent.click(await screen.findByRole("link", { name: /Night drive/ }));
    const playlistTracks = await screen.findByLabelText("Night drive tracks");

    expect(
      within(playlistTracks).queryByRole("link", { name: /^Open album$/ }),
    ).not.toBeInTheDocument();
    const mirageAlbumLinks = within(playlistTracks).getAllByRole("link", {
      name: /^Open album for Mirage$/,
    });
    const lanternsAlbumLinks = within(playlistTracks).getAllByRole("link", {
      name: /^Open album for Lanterns$/,
    });
    expect(mirageAlbumLinks).toHaveLength(2);
    expect(lanternsAlbumLinks).toHaveLength(2);
    expect(
      new Set(
        [...mirageAlbumLinks, ...lanternsAlbumLinks].map((link) =>
          link.getAttribute("aria-label"),
        ),
      ),
    ).toEqual(new Set(["Open album for Mirage", "Open album for Lanterns"]));
  });

  it("uses the first track artwork when Bandcamp omits a playlist cover", async () => {
    mocks.fetchPlaylist.mockResolvedValueOnce({
      ...detail,
      tracks: [{ ...track, coverArt: "first-track-cover" }],
    });
    const { container } = renderSavedLibraryRoute({
      initialEntry: "/playlists",
    });

    fireEvent.click(await screen.findByRole("link", { name: /Night drive/ }));

    await waitFor(() =>
      expect(
        container.querySelector("header img")?.getAttribute("src"),
      ).toMatch(
        /^coda-cover:\/v1\/600\/first-track-cover\?v=0&s=[a-f0-9]{32}$/u,
      ),
    );
  });

  it("keeps replaced playlist artwork pending over its base color until load", async () => {
    mocks.fetchPlaylist.mockResolvedValueOnce({
      ...detail,
      tracks: [{ ...track, coverArt: "first-track-cover" }],
    });
    const { container, queryClient } = renderSavedLibraryRoute({
      initialEntry: "/playlists",
    });

    fireEvent.click(await screen.findByRole("link", { name: /Night drive/ }));
    await waitFor(() =>
      expect(
        container.querySelector("header img")?.getAttribute("src"),
      ).toMatch(
        /^coda-cover:\/v1\/600\/first-track-cover\?v=0&s=[a-f0-9]{32}$/u,
      ),
    );

    act(() => {
      queryClient.setQueryData(["bandcamp", "playlists", "playlist-1"], {
        ...detail,
        tracks: [{ ...track, id: "song-2", coverArt: "next-track-cover" }],
      });
    });
    const nextImage = await waitFor(() => {
      const image = container.querySelector<HTMLImageElement>("header img");
      if (!image) throw new Error("Expected replacement playlist artwork");
      expect(image.getAttribute("src")).toMatch(
        /^coda-cover:\/v1\/600\/next-track-cover\?v=0&s=[a-f0-9]{32}$/u,
      );
      expect(image).not.toHaveClass("invisible");
      expect(image).toHaveAttribute("data-cover-art-pending");
      expect(
        container.querySelector("header [data-favorite-artwork-fallback]"),
      ).not.toBeInTheDocument();
      return image;
    });

    fireEvent.load(nextImage);
    expect(nextImage).not.toHaveAttribute("data-cover-art-pending");
    expect(nextImage).toHaveAttribute("data-cover-art-reveal");
  });

  it("invalidates and retries a broken playlist cover once", async () => {
    mocks.fetchPlaylist.mockResolvedValueOnce({
      ...detail,
      tracks: [{ ...track, coverArt: "first-track-cover" }],
    });
    const { container } = renderSavedLibraryRoute({
      initialEntry: "/playlists",
    });

    fireEvent.click(await screen.findByRole("link", { name: /Night drive/ }));
    const expired = await waitFor(() => {
      const image = container.querySelector<HTMLImageElement>("header img");
      if (!image) throw new Error("Expected playlist artwork");
      expect(image.getAttribute("src")).toMatch(
        /^coda-cover:\/v1\/600\/first-track-cover\?v=0&s=[a-f0-9]{32}$/u,
      );
      return image;
    });
    fireEvent.error(expired);

    await waitFor(() =>
      expect(mocks.invalidateCoverArt).toHaveBeenCalledWith(
        "first-track-cover",
      ),
    );
    const retried = await waitFor(() => {
      const image = container.querySelector<HTMLImageElement>("header img");
      if (!image) throw new Error("Expected retried playlist artwork");
      expect(image.getAttribute("src")).toMatch(
        /^coda-cover:\/v1\/600\/first-track-cover\?v=retry-\d+&s=[a-f0-9]{32}$/u,
      );
      return image;
    });
    fireEvent.error(retried);
    expect(container.querySelector("header img")).not.toBeInTheDocument();
    expect(mocks.invalidateCoverArt).toHaveBeenCalledOnce();
  });

  it("moves focus into playlist details and restores the opening row on Back", async () => {
    renderSavedLibraryRoute({ initialEntry: "/playlists" });

    const playlistButton = await screen.findByRole("link", {
      name: /Night drive/,
    });
    playlistButton.focus();
    fireEvent.click(playlistButton);

    const heading = await screen.findByRole("heading", {
      name: "Night drive",
    });
    await waitFor(() => expect(heading).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    const restoredPlaylistButton = await screen.findByRole("link", {
      name: /Night drive/,
    });
    await waitFor(() => expect(restoredPlaylistButton).toHaveFocus());
  });

  it("matches playlist and track play controls to the current player state", async () => {
    const onTogglePlayback = vi.fn();
    renderSavedLibraryRoute({
      initialEntry: "/playlists",
      runtime: {
        ...commonProps,
        currentTrackId: "song-1",
        onTogglePlayback,
        playing: true,
      },
    });

    fireEvent.click(await screen.findByRole("link", { name: /Night drive/ }));
    expect(
      await screen.findByRole("button", { name: "Pause Night drive" }),
    ).toHaveAttribute("aria-pressed", "true");
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
      renderSavedLibraryRoute({ initialEntry: "/playlists" });

      fireEvent.click(await screen.findByRole("link", { name: /Night drive/ }));
      const list = await screen.findByRole("list", {
        name: "Night drive tracks",
      });
      await waitFor(() => {
        const rows = within(list).getAllByRole("listitem");
        expect(rows.length).toBeGreaterThan(1);
        expect(rows.length).toBeLessThan(30);
      });
      expect(list).toHaveAttribute("data-virtualized", "true");
      const rows = within(list)
        .getAllByRole("listitem")
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
});
