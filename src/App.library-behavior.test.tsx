import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Album, Track } from "./types";
import { album, deferred, mocks, renderApp, single, tracks } from "./test/appTestHarness";

describe("Coda library behavior flows", { timeout: 10_000 }, () => {

  it("separates release types and navigates through artist and album views", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album, single]);
    mocks.fetchAlbum.mockImplementation((requestedAlbum: Album) =>
      Promise.resolve(
        (requestedAlbum.id === single.id ? single.tracks : album.tracks) ?? [],
      ),
    );
    renderApp();

    await screen.findByText("Soft Focus");
    fireEvent.click(screen.getByRole("button", { name: /Singles\s*1/ }));
    expect(await screen.findByText("Streetlight")).toBeInTheDocument();
    expect(screen.queryByText("Soft Focus")).not.toBeInTheDocument();
    expect(screen.getByRole("button", {
      name: "Surprise me from the singles view",
    })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "Open Streetlight" }));
    const singlePage = await screen.findByRole("article", {
      name: "Streetlight release details",
    });
    expect(singlePage).toBeInTheDocument();
    const singleTrackControl = within(singlePage).getByRole("button", {
      name: "Play Streetlight",
    });
    expect(within(singleTrackControl.parentElement!).getByText("2:44"))
      .toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "1 song" })).toBeInTheDocument();
    expect(screen.getByRole("button", {
      name: "Surprise me from Streetlight",
    })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    fireEvent.click(await screen.findByTitle("Browse Glass Taxi"));
    const artistHeading = await screen.findByRole("heading", {
      name: "Glass Taxi",
    });
    expect(artistHeading).toBeInTheDocument();
    expect(artistHeading.previousElementSibling).toHaveClass("block");
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play all" })).toBeInTheDocument();
    expect(screen.getByRole("button", {
      name: "Surprise me from Glass Taxi",
    })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Shuffle" }));
    expect(await screen.findByRole("link", { name: "Open Now Playing" }))
      .toBeInTheDocument();
    expect(screen.getAllByText("Streetlight").length).toBeGreaterThan(0);
  });

  it("adds a Collection album to the queue from its card action", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    renderApp();

    await screen.findByText("Soft Focus");
    const queueAlbum = screen.getByRole("button", {
      name: "Add Soft Focus to queue",
    });

    fireEvent.click(queueAlbum);
    const player = await screen.findByRole("contentinfo");
    expect(within(player).getByText("First Light")).toBeInTheDocument();
  });

  it.each([
    ["Play all"],
    ["Shuffle"],
    ["Add all"],
  ] as const)(
    "scopes %s to the selected artist on a compilation",
    async (actionName) => {
      const guestArtist = "Guest Artist";
      const compilationTrack = {
        ...tracks[0],
        id: "track-compilation-guest",
        title: "Guest Selection",
        artist: guestArtist,
        albumArtist: "Various Artists",
        album: "Night Compendium",
        albumId: "album-compilation",
      };
      const otherTrack = {
        ...tracks[1],
        id: "track-compilation-other",
        title: "Other Selection",
        artist: "Other Artist",
        albumArtist: "Various Artists",
        album: "Night Compendium",
        albumId: "album-compilation",
      };
      const compilationTracks = [compilationTrack, otherTrack];
      const compilation = {
        ...album,
        id: "album-compilation",
        title: "Night Compendium",
        artist: "Various Artists",
        tracks: compilationTracks,
        songCount: compilationTracks.length,
        duration: compilationTracks.reduce(
          (total, track) => total + track.duration,
          0,
        ),
      };
      mocks.hasConnection.mockResolvedValue(true);
      mocks.fetchLibrary.mockResolvedValue([compilation]);
      mocks.fetchAlbum.mockResolvedValue(compilationTracks);
      renderApp();

      await screen.findByText("Night Compendium");
      fireEvent.click(screen.getByRole("link", {
        name: "Open Night Compendium",
      }));
      const albumPage = await screen.findByRole("article", {
        name: "Night Compendium release details",
      });
      fireEvent.click(within(albumPage).getByRole("link", {
        name: guestArtist,
      }));

      const heading = await screen.findByRole("heading", { name: guestArtist });
      const artistHero = heading.closest("section");
      if (!artistHero) {
        throw new Error("Expected the artist heading in its hero");
      }
      expect(artistHero).toHaveTextContent("1 release · 1 track · 3:00");
      expect(screen.getByRole("link", { name: "Open Night Compendium" }))
        .toBeInTheDocument();
      fireEvent.click(within(artistHero).getByRole("button", {
        name: actionName,
      }));

      const player = await screen.findByRole("contentinfo");
      await within(player).findByText("Guest Selection");
      expect(within(player).queryByText("Other Selection"))
        .not.toBeInTheDocument();
      expect(within(player).getByRole("button", { name: "Next" }))
        .toBeDisabled();
    },
  );

  it(
    "scopes the Surprise Me track branch to the selected compilation artist",
    async () => {
      const compilationTracks = [
        {
          ...tracks[0],
          id: "track-compilation-guest",
          title: "Guest Selection",
          artist: "Guest Artist",
          albumArtist: "Various Artists",
          album: "Night Compendium",
          albumId: "album-compilation",
        },
        {
          ...tracks[1],
          id: "track-compilation-other",
          title: "Other Selection",
          artist: "Other Artist",
          albumArtist: "Various Artists",
          album: "Night Compendium",
          albumId: "album-compilation",
        },
      ];
      const compilation = {
        ...album,
        id: "album-compilation",
        title: "Night Compendium",
        artist: "Various Artists",
        tracks: compilationTracks,
        songCount: compilationTracks.length,
      };
      mocks.hasConnection.mockResolvedValue(true);
      mocks.fetchLibrary.mockResolvedValue([compilation]);
      mocks.fetchAlbum.mockResolvedValue(compilationTracks);
      let random: ReturnType<typeof vi.spyOn> | undefined;
      try {
        renderApp();

        await screen.findByText("Night Compendium");
        fireEvent.click(screen.getByRole("link", {
          name: "Open Night Compendium",
        }));
        const albumPage = await screen.findByRole("article", {
          name: "Night Compendium release details",
        });
        fireEvent.click(within(albumPage).getByRole("link", {
          name: "Guest Artist",
        }));

        await screen.findByRole("heading", { name: "Guest Artist" });
        random = vi.spyOn(Math, "random").mockReturnValue(0.75);
        fireEvent.click(await screen.findByRole("button", {
          name: "Surprise me from Guest Artist",
        }));
        const player = await screen.findByRole("contentinfo");
        await within(player).findByText("Guest Selection");
        expect(within(player).queryByText("Other Selection"))
          .not.toBeInTheDocument();
        expect(within(player).getByRole("button", { name: "Next" }))
          .toBeDisabled();
      } finally {
        random?.mockRestore();
      }
    },
  );

  it("keeps artist navigation selected while a deferred search clears", async () => {
    const unrelatedAlbum = {
      ...album,
      id: "album-unrelated",
      title: "Unrelated Echo",
      artist: "Other Artist",
      tracks: [tracks[1]],
    };
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album, unrelatedAlbum]);
    renderApp();

    await screen.findByText("Soft Focus");
    fireEvent.click(screen.getByRole("button", { name: "Play Soft Focus" }));
    const player = await screen.findByRole("contentinfo");
    const search = screen.getByPlaceholderText("Search your collection");
    fireEvent.change(search, { target: { value: "Unrelated Echo" } });
    await screen.findByRole("link", { name: "Open Unrelated Echo" });

    fireEvent.click(within(player).getByRole("link", {
      name: "Night Archive",
    }));

    expect(await screen.findByRole("heading", { name: "Night Archive" }))
      .toBeInTheDocument();
    expect(search).toHaveValue("");
    expect(screen.getByRole("link", { name: "Open Soft Focus" }))
      .toBeInTheDocument();
  });

  it("applies a new search entered from an artist page", async () => {
    const unrelatedAlbum = {
      ...album,
      id: "album-unrelated",
      title: "Unrelated Echo",
      artist: "Other Artist",
      tracks: [tracks[1]],
    };
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album, unrelatedAlbum]);
    renderApp();

    await screen.findByText("Soft Focus");
    fireEvent.click(screen.getByTitle("Browse Night Archive"));
    expect(await screen.findByRole("heading", { name: "Night Archive" }))
      .toBeInTheDocument();

    fireEvent.change(
      screen.getByPlaceholderText("Search your collection"),
      { target: { value: "Unrelated Echo" } },
    );

    expect(await screen.findByText("Other Artist")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Night Archive" }))
      .not.toBeInTheDocument();
  });

  it("preloads album tracks after startup and reuses the request on activation", async () => {
    const user = userEvent.setup();
    const request = deferred<Track[]>();
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    mocks.fetchAlbum.mockReturnValueOnce(request.promise);
    renderApp();

    await screen.findByText("Soft Focus");
    const openButton = screen.getByRole("link", { name: "Open Soft Focus" });
    await user.hover(openButton);
    await waitFor(() => expect(mocks.fetchAlbum).toHaveBeenCalledOnce());
    expect(mocks.hasConnection).toHaveBeenCalledOnce();

    fireEvent.click(openButton);
    const albumPage = await screen.findByRole("article", {
      name: "Soft Focus release details",
    });
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(within(albumPage).getByRole("status", {
      name: "Loading album tracks",
    })).toBeInTheDocument();
    expect(mocks.fetchAlbum).toHaveBeenCalledOnce();

    await act(async () => request.resolve(tracks));
    expect(within(albumPage).getByText("First Light")).toBeInTheDocument();
  });

  it("keeps a cold album busy when an older album request settles", async () => {
    const secondTracks: Track[] = [{
      ...tracks[0],
      id: "track-second",
      title: "Other Light",
      album: "Other Focus",
      albumId: "album-2",
    }];
    const secondAlbum: Album = {
      ...album,
      id: "album-2",
      title: "Other Focus",
      songCount: secondTracks.length,
      duration: secondTracks[0].duration,
      tracks: secondTracks,
    };
    const firstRequest = deferred<Track[]>();
    const secondRequest = deferred<Track[]>();
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album, secondAlbum]);
    mocks.fetchAlbum.mockImplementation((requestedAlbum: Album) =>
      requestedAlbum.id === album.id
        ? firstRequest.promise
        : secondRequest.promise,
    );
    renderApp();

    await screen.findByText("Soft Focus");
    fireEvent.click(screen.getByRole("button", { name: "Play Soft Focus" }));
    fireEvent.click(screen.getByRole("link", { name: "Open Other Focus" }));
    const albumPage = await screen.findByRole("article", {
      name: "Other Focus release details",
    });
    expect(within(albumPage).getByText("Loading tracks…")).toBeInTheDocument();

    await act(async () => firstRequest.resolve(tracks));

    expect(within(albumPage).getByText("Loading tracks…")).toBeInTheDocument();
    await act(async () => secondRequest.resolve(secondTracks));
    expect(within(albumPage).getByText("Other Light")).toBeInTheDocument();
  });

  it("opens a cold album shell while its tracks hydrate without a snapshot", async () => {
    const request = deferred<Track[]>();
    let requestSettled = false;
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    mocks.fetchAlbum.mockReturnValueOnce(request.promise);
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "startViewTransition",
    );
    const startViewTransition = vi.fn((update: () => void | Promise<void>) => {
      const updateCallbackDone = Promise.resolve(update());
      return { finished: updateCallbackDone, updateCallbackDone };
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    try {
      renderApp();

      await screen.findByText("Soft Focus");
      fireEvent.click(screen.getByRole("link", { name: "Open Soft Focus" }));
      expect(document.documentElement).toHaveClass(
        "coda-transition--page-forward",
      );

      const albumPage = await screen.findByRole("article", {
        name: "Soft Focus release details",
      });
      const trackList = within(albumPage).getByRole("region", {
        name: "Track list",
      });
      expect(startViewTransition).not.toHaveBeenCalled();
      expect(screen.getAllByRole("status")).toHaveLength(1);
      expect(within(albumPage).getByRole("status", {
        name: "Loading album tracks",
      })).toBeInTheDocument();
      expect(trackList).toHaveAttribute("aria-busy", "true");
      expect(screen.queryByRole("status", {
        name: "Loading Soft Focus",
      })).not.toBeInTheDocument();

      await act(async () => {
        requestSettled = true;
        request.resolve(tracks);
      });
      await waitFor(() =>
        expect(within(albumPage).queryByRole("status", {
          name: "Loading album tracks",
        })).not.toBeInTheDocument(),
      );
      expect(trackList).not.toHaveAttribute("aria-busy");
      expect(within(albumPage).getByText("First Light")).toBeInTheDocument();
    } finally {
      if (!requestSettled) {
        await act(async () => request.resolve(tracks));
      }
      if (originalDescriptor) {
        Object.defineProperty(document, "startViewTransition", originalDescriptor);
      } else {
        Reflect.deleteProperty(document, "startViewTransition");
      }
    }
  });

  it("opens a cold album at the top and restores the Collection scroll position on Back", async () => {
    const request = deferred<Track[]>();
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    mocks.fetchAlbum.mockReturnValueOnce(request.promise);
    renderApp();

    await screen.findByText("Soft Focus");
    const libraryPane = screen.getByRole("main");
    libraryPane.scrollTop = 312;
    const openAlbumButton = screen.getByRole("link", {
      name: "Open Soft Focus",
    });
    openAlbumButton.focus();

    fireEvent.click(openAlbumButton);

    const albumPage = await screen.findByRole("article", {
      name: "Soft Focus release details",
    });
    await waitFor(() =>
      expect(within(albumPage).getByRole("heading", { name: "Soft Focus" }))
        .toHaveFocus(),
    );
    expect(within(albumPage).getByRole("status", {
      name: "Loading album tracks",
    })).toBeInTheDocument();
    expect(libraryPane.scrollTop).toBe(0);

    await act(async () => request.resolve(tracks));
    fireEvent.click(within(albumPage).getByRole("button", {
      name: "Back",
    }));

    expect(await screen.findByRole("list", {
      name: "All releases",
    })).toBeInTheDocument();
    expect(libraryPane.scrollTop).toBe(312);
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Open Soft Focus" }))
        .toHaveFocus(),
    );
  });
});
