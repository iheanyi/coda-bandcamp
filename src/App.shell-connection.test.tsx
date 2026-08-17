import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LIBRARY_STARTUP_STEP_TIMEOUT_MS } from "./libraryStartup";
import type { Album, Track } from "./types";
import { album, deferred, mocks, renderApp, tracks } from "./test/appTestHarness";

describe("Coda shell and connection flows", () => {
  it("announces the initial collection skeleton without a competing spinner", async () => {
    const request = deferred<Album[]>();
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockReturnValue(request.promise);
    renderApp();

    const loadingStatus = await screen.findByRole("status", {
      name: "Loading your collection",
    });
    expect(loadingStatus).toHaveAttribute("aria-busy", "true");
    expect(
      loadingStatus.querySelectorAll('[data-slot="skeleton"]'),
    ).not.toHaveLength(0);
    expect(
      loadingStatus.querySelector('[data-slot="spinner"]'),
    ).not.toBeInTheDocument();

    await act(async () => request.resolve([album]));
  });

  it("stops checking when the saved connection probe does not settle", async () => {
    // Keep RAF real so Motion's shared frame loop cannot be stranded when the
    // startup deadline test restores the clock for the next App flow.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      mocks.hasConnection.mockReturnValue(new Promise(() => undefined));

      const { router } = renderApp();
      await act(async () => router.load());

      expect(screen.getByText("Checking your saved connection…"))
        .toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(LIBRARY_STARTUP_STEP_TIMEOUT_MS + 1);
      });

      expect(screen.queryByText("Checking your saved connection…"))
        .not.toBeInTheDocument();
      expect(screen.getByText("Your collection couldn’t load"))
        .toBeInTheDocument();
      expect(screen.getByText(
        "Checking your saved connection took too long. Try again.",
      ))
        .toBeInTheDocument();

      const cachedAt = Date.now();
      mocks.hasConnection.mockResolvedValue(true);
      mocks.loadLibraryCache.mockResolvedValue({
        savedAt: cachedAt,
        lastFullSyncAt: cachedAt,
        albums: [album],
      });
      fireEvent.click(screen.getByRole("button", { name: "Try checking again" }));
      vi.useRealTimers();

      expect(await screen.findByText("Soft Focus")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to a live sync when native cache hydration does not settle", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      mocks.hasConnection.mockResolvedValue(true);
      mocks.loadLibraryCache.mockReturnValue(new Promise(() => undefined));
      mocks.fetchLibrary.mockResolvedValue([album]);

      const { router } = renderApp();
      await act(async () => router.load());

      expect(screen.getByText("Checking your saved connection…"))
        .toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(LIBRARY_STARTUP_STEP_TIMEOUT_MS + 1);
      });

      expect(mocks.fetchLibrary).toHaveBeenCalledWith(expect.any(Function), {
        forceFull: false,
      });
      vi.useRealTimers();
      expect(await screen.findByText("Soft Focus")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("dismisses connection settings with Escape and restores trigger focus", async () => {
    renderApp();

    const trigger = await screen.findByRole("button", {
      name: "Connection settings",
    });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", {
      name: "Bring in your collection",
    });
    expect(dialog).toHaveAttribute("data-open");

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByRole("dialog", {
        name: "Bring in your collection",
      })).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });

  it("locks the application behind connection settings", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    renderApp();

    await screen.findByText("Soft Focus");
    fireEvent.click(screen.getByRole("button", { name: "Play Soft Focus" }));
    const pause = await screen.findByRole("button", { name: "Pause" });
    fireEvent.click(screen.getByRole("button", { name: "Connection settings" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Bandcamp is connected",
    });

    await waitFor(() =>
      expect(pause.closest("[data-base-ui-inert]")).not.toBeNull()
    );
    await waitFor(() => expect(dialog).toBeVisible());
  });

  it("locks the connection dialog through a pending Bandcamp request and renders its result", async () => {
    let resolveConnection!: (albums: Album[]) => void;
    const pendingConnection = new Promise<Album[]>((resolve) => {
      resolveConnection = resolve;
    });
    mocks.connectBandcamp.mockReturnValue(pendingConnection);
    renderApp();

    fireEvent.click(await screen.findByRole("button", { name: "Connect Bandcamp" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Bring in your collection",
    });
    fireEvent.change(within(dialog).getByLabelText("Subsonic username"), {
      target: { value: "generated-user" },
    });
    fireEvent.change(within(dialog).getByLabelText("Subsonic password"), {
      target: { value: "generated-password" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Connect Bandcamp" }));
    expect(mocks.connectBandcamp).toHaveBeenCalledWith(
      {
        username: "generated-user",
        password: "generated-password",
      },
      expect.any(Function),
    );
    expect(await within(dialog).findByRole("button", {
      name: "Connecting securely…",
    })).toBeDisabled();
    expect(within(dialog).getByLabelText("Subsonic username")).toBeDisabled();
    expect(within(dialog).getByLabelText("Subsonic password")).toBeDisabled();

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.pointerDown(document.body);
    fireEvent.mouseDown(document.body);
    fireEvent.click(document.body);

    expect(screen.getByRole("dialog", {
      name: "Bring in your collection",
    })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeDisabled();

    await act(async () => {
      resolveConnection([album]);
      await pendingConnection;
    });
    expect(await screen.findByText("Soft Focus")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ambient" })).toBeInTheDocument();
  });

  it("locks Last.fm authorization while pending and completes without collecting a password", async () => {
    let resolveAuthorization!: (authorization: {
      authorizationUrl: string;
      token: string;
    }) => void;
    const pendingAuthorization = new Promise<{
      authorizationUrl: string;
      token: string;
    }>((resolve) => {
      resolveAuthorization = resolve;
    });
    mocks.beginLastFmAuthorization.mockReturnValue(pendingAuthorization);
    mocks.completeLastFmAuthorization.mockResolvedValue({
      configured: true,
      connected: true,
      username: "nightlistener",
    });
    renderApp();

    fireEvent.click(await screen.findByRole("button", {
      name: "Connection settings",
    }));
    const dialog = await screen.findByRole("dialog", {
      name: "Bring in your collection",
    });
    expect(within(dialog).queryByLabelText(/Last\.fm password/i))
      .not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", {
      name: "Connect Last.fm",
    }));
    expect(await within(dialog).findByRole("button", {
      name: "Opening Last.fm…",
    })).toBeDisabled();

    try {
      fireEvent.keyDown(document, { key: "Escape" });
      fireEvent.pointerDown(document.body);
      fireEvent.mouseDown(document.body);
      fireEvent.click(document.body);

      expect(screen.getByRole("dialog", {
        name: "Bring in your collection",
      })).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "Close" }))
        .toBeDisabled();
    } finally {
      await act(async () => {
        resolveAuthorization({
          authorizationUrl:
            "https://www.last.fm/api/auth/?api_key=key&token=deferred-token",
          token: "deferred-token",
        });
        await pendingAuthorization;
      });
    }

    await waitFor(() =>
      expect(mocks.openLastFmAuthorization).toHaveBeenCalledOnce(),
    );
    fireEvent.click(within(dialog).getByRole("button", {
      name: "Finish connection",
    }));
    expect(await within(dialog).findByText("nightlistener")).toBeInTheDocument();
    expect(mocks.completeLastFmAuthorization)
      .toHaveBeenCalledWith("deferred-token");
  });

  it("wires the collection sort select and scrollable genre navigation to rendered results", async () => {
    const user = userEvent.setup();
    const collection = [
      { artist: "Zulu", genre: "Ambient", title: "Zulu Ambient" },
      { artist: "Cobalt", genre: "Electronic", title: "Cobalt Electronic" },
      { artist: "Delta", genre: "Folk", title: "Delta Folk" },
      { artist: "Echo", genre: "Jazz", title: "Echo Jazz" },
      { artist: "Foxtrot", genre: "Metal", title: "Foxtrot Metal" },
      { artist: "Aardvark", genre: "Rock", title: "Aardvark Rock" },
    ].map((metadata, index): Album => ({
      ...album,
      ...metadata,
      id: `album-filter-${index}`,
    }));
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue(collection);
    renderApp();

    await screen.findByText("Zulu Ambient");
    const sort = screen.getByRole("combobox", {
      name: "Sort collection",
    });
    await user.click(sort);
    await user.click(await screen.findByRole("option", {
      name: "Artist A–Z",
    }));
    expect(sort).toHaveTextContent("Artist A–Z");
    await waitFor(() =>
      expect(screen.getAllByRole("link", {
        name: /^Open /,
      })[0]).toHaveAccessibleName("Open Aardvark Rock"),
    );

    const genres = screen.getByRole("navigation", {
      name: "Filter collection by genre",
    });
    expect(genres).toHaveClass("overflow-x-auto");
    expect(screen.queryByRole("combobox", {
      name: "More collection genres",
    })).not.toBeInTheDocument();
    Object.defineProperties(genres, {
      clientWidth: { configurable: true, value: 240 },
      scrollWidth: { configurable: true, value: 720 },
    });
    fireEvent(window, new Event("resize"));
    expect(screen.getByRole("button", {
      name: "Show more genres",
    })).toBeInTheDocument();

    Object.defineProperty(genres, "scrollLeft", {
      configurable: true,
      value: 480,
      writable: true,
    });
    fireEvent.scroll(genres);
    expect(screen.getByRole("button", {
      name: "Show previous genres",
    })).toBeInTheDocument();
    expect(screen.queryByRole("button", {
      name: "Show more genres",
    })).not.toBeInTheDocument();

    await user.click(within(genres).getByRole("button", {
      name: "Rock",
    }));

    expect(await screen.findByRole("button", { name: "Rock" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("link", {
      name: "Open Aardvark Rock",
    })).toBeInTheDocument();
    expect(screen.queryByRole("link", {
      name: "Open Zulu Ambient",
    })).not.toBeInTheDocument();
  });

  it("keeps Recently added newest-first after the Collection sort changes", async () => {
    const user = userEvent.setup();
    const addedDates = [
      "31 Dec 2024 23:59:59 GMT",
      "02 Jan 2025 12:00:00 GMT",
      "30 Jan 2025 12:00:00 GMT",
      "02 Feb 2025 12:00:00 GMT",
      "28 Feb 2025 12:00:00 GMT",
      "01 Mar 2025 12:00:00 GMT",
      "30 Jun 2025 12:00:00 GMT",
      "02 Jul 2025 12:00:00 GMT",
      "31 Jul 2025 12:00:00 GMT",
      "01 Aug 2025 12:00:00 GMT",
      "30 Sep 2025 12:00:00 GMT",
      "01 Oct 2025 12:00:00 GMT",
      "31 Dec 2025 12:00:00 GMT",
    ];
    const collection = addedDates.map((addedAt, index): Album => ({
      ...album,
      id: `recent-${index + 1}`,
      title: `Release ${String(index + 1).padStart(2, "0")}`,
      artist: `Artist ${String(index + 1).padStart(2, "0")}`,
      addedAt,
    }));
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue(collection);
    renderApp();

    await screen.findByText("Release 01");
    const sort = screen.getByRole("combobox", { name: "Sort collection" });
    await user.click(sort);
    await user.click(await screen.findByRole("option", { name: "Artist A–Z" }));
    await user.click(screen.getByRole("link", { name: "Recently added" }));

    expect(await screen.findByText("Newest first")).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "Sort collection" }),
    ).not.toBeInTheDocument();
    expect(
      (await screen.findAllByRole("link", { name: /^Open Release/ }))
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(
      Array.from({ length: 12 }, (_, index) =>
        `Open Release ${String(13 - index).padStart(2, "0")}`,
      ),
    );
    expect(
      screen.queryByRole("link", { name: "Open Release 01" }),
    ).not.toBeInTheDocument();
  });

  it("uses a fresh native library cache without revalidating", async () => {
    const cachedAt = Date.now();
    mocks.hasConnection.mockResolvedValue(true);
    mocks.loadLibraryCache.mockResolvedValue({
      savedAt: cachedAt,
      lastFullSyncAt: cachedAt,
      albums: [album],
    });
    mocks.fetchLibrary.mockResolvedValue([album]);

    renderApp();

    expect(await screen.findByText("Soft Focus")).toBeInTheDocument();
    expect(mocks.fetchLibrary).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /^sync$/i }));
    await waitFor(() =>
      expect(mocks.fetchLibrary).toHaveBeenCalledWith(expect.any(Function), {
        forceFull: true,
      }),
    );
  });

  it("shows progressive sync pages and restores cached data after a failed refresh", async () => {
    const progressiveAlbum: Album = {
      ...album,
      id: "progressive-album",
      title: "Arriving now",
    };
    let rejectRefresh!: (cause: Error) => void;
    const staleAt = Date.now() - 16 * 60 * 1_000;
    mocks.hasConnection.mockResolvedValue(true);
    mocks.loadLibraryCache.mockResolvedValue({
      savedAt: staleAt,
      lastFullSyncAt: staleAt,
      albums: [album],
    });
    mocks.fetchLibrary.mockImplementation(
      (onPage?: (progress: {
        pageIndex: number;
        loaded: number;
        albums: Album[];
      }) => void) => {
        onPage?.({
          pageIndex: 0,
          loaded: 1,
          albums: [progressiveAlbum],
        });
        return new Promise((_, reject) => {
          rejectRefresh = reject;
        });
      },
    );

    renderApp();

    expect(await screen.findByText("Arriving now")).toBeInTheDocument();
    expect(mocks.fetchLibrary).toHaveBeenCalledWith(expect.any(Function), {
      forceFull: false,
    });
    rejectRefresh(new Error("Refresh unavailable"));
    expect(await screen.findByText("Refresh unavailable")).toBeInTheDocument();
    expect(screen.getByText("Soft Focus")).toBeInTheDocument();
    expect(screen.queryByText("Arriving now")).not.toBeInTheDocument();
  });

  it("ignores a native cache read that resolves after disconnect", async () => {
    let resolveCache!: (snapshot: {
      savedAt: number;
      lastFullSyncAt: number;
      albums: Album[];
    }) => void;
    mocks.hasConnection.mockResolvedValue(true);
    mocks.loadLibraryCache.mockReturnValue(new Promise((resolve) => {
      resolveCache = resolve;
    }));
    mocks.fetchLibrary.mockResolvedValue([album]);

    renderApp();

    await screen.findByText("Synced");
    fireEvent.click(screen.getByRole("button", { name: "Connection settings" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Bandcamp is connected",
    });
    const disconnectButton = within(dialog).getByRole("button", {
      name: "Disconnect and remove Bandcamp credentials",
    });
    expect(disconnectButton).toBeEnabled();
    fireEvent.click(disconnectButton);
    expect(await screen.findByText("Your collection starts here")).toBeInTheDocument();

    const cachedAt = Date.now();
    resolveCache({
      savedAt: cachedAt,
      lastFullSyncAt: cachedAt,
      albums: [album],
    });
    await waitFor(() => expect(mocks.fetchLibrary).not.toHaveBeenCalled());
    expect(screen.queryByText("Soft Focus")).not.toBeInTheDocument();
  });

  it("clears authenticated album queries after a successful disconnect", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    const { queryClient } = renderApp();

    await screen.findByText("Soft Focus");
    queryClient.setQueryData(["bandcamp", "album", album.id], tracks);
    queryClient.setQueryData(["bandcamp-radio-show", 979], { id: 979 });
    fireEvent.click(screen.getByRole("button", { name: "Connection settings" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Bandcamp is connected",
    });
    fireEvent.click(within(dialog).getByRole("button", {
      name: "Disconnect and remove Bandcamp credentials",
    }));

    expect(await screen.findByText("Your collection starts here")).toBeInTheDocument();
    expect(queryClient.getQueryData(["bandcamp", "album", album.id]))
      .toBeUndefined();
    expect(queryClient.getQueryData(["bandcamp-radio-show", 979])).toEqual({
      id: 979,
    });
    expect(screen.getByText("Bandcamp credentials removed"))
      .toBeInTheDocument();
  });

  it("does not let a bulk artist load restore playback after disconnect", async () => {
    const firstAlbum: Album = {
      ...album,
      tracks: undefined,
    };
    const secondTrack: Track = {
      ...tracks[1],
      id: "track-3",
      album: "Night Signals",
      albumId: "album-2",
      track: 1,
    };
    const secondAlbum: Album = {
      ...album,
      id: "album-2",
      title: "Night Signals",
      tracks: undefined,
    };
    let resolveFirstAlbum!: (value: Track[]) => void;
    let resolveSecondAlbum!: (value: Track[]) => void;
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([firstAlbum, secondAlbum]);
    mocks.fetchAlbum
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveFirstAlbum = resolve;
      }))
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveSecondAlbum = resolve;
      }));
    const { queryClient } = renderApp();

    await screen.findByText("Soft Focus");
    fireEvent.click(screen.getAllByTitle("Browse Night Archive")[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Play all" }));
    await waitFor(() => expect(mocks.fetchAlbum).toHaveBeenCalledTimes(2));
    const firstRequestedAlbum = mocks.fetchAlbum.mock.calls[0][0];

    await act(async () => {
      resolveFirstAlbum([tracks[0]]);
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(
        queryClient.getQueryData<Track[]>([
          "bandcamp",
          "album",
          firstRequestedAlbum.id,
        ]),
      ).toEqual([
        expect.objectContaining({
          albumId: tracks[0].albumId,
          id: tracks[0].id,
          title: tracks[0].title,
        }),
      ]),
    );
    expect(
      queryClient.getQueryData<Track[]>([
        "bandcamp",
        "album",
        firstRequestedAlbum.id,
      ])?.[0],
    ).not.toHaveProperty("streamUrl");

    fireEvent.click(screen.getByRole("button", { name: "Connection settings" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Bandcamp is connected",
    });
    fireEvent.click(within(dialog).getByRole("button", {
      name: "Disconnect and remove Bandcamp credentials",
    }));
    expect(await screen.findByText("Your collection starts here")).toBeInTheDocument();

    await act(async () => {
      resolveSecondAlbum([secondTrack]);
      await Promise.resolve();
    });

    expect(screen.getByText("Your collection starts here")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open Now Playing" }))
      .not.toBeInTheDocument();
    expect(screen.queryByText("Playing Night Archive")).not.toBeInTheDocument();
    expect(queryClient.getQueryCache().findAll({
      queryKey: ["bandcamp", "album"],
    })).toHaveLength(0);
  });

  it("force-refreshes missing artwork through the album query", async () => {
    const missingArtworkAlbum: Album = {
      ...album,
      tracks: undefined,
      coverArt: undefined,
    };
    const recoveredTracks = tracks.map((track) => ({
      ...track,
      coverArt: "recovered-cover",
    }));
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([missingArtworkAlbum]);
    mocks.fetchAlbum.mockResolvedValue(recoveredTracks);
    renderApp();

    await screen.findByText("Soft Focus");
    fireEvent.click(screen.getByRole("button", { name: "Artwork" }));

    await waitFor(() =>
      expect(mocks.fetchAlbum).toHaveBeenCalledWith(
        expect.objectContaining({ id: album.id }),
        { forceRefresh: true },
      ),
    );
    expect(await screen.findByText("1 missing cover recovered")).toBeInTheDocument();
  });

  it("keeps an active sync valid when native disconnect fails", async () => {
    let resolveRefresh!: (albums: Album[]) => void;
    const staleAt = Date.now() - 16 * 60 * 1_000;
    mocks.hasConnection.mockResolvedValue(true);
    mocks.loadLibraryCache.mockResolvedValue({
      savedAt: staleAt,
      lastFullSyncAt: staleAt,
      albums: [album],
    });
    mocks.fetchLibrary.mockReturnValue(new Promise((resolve) => {
      resolveRefresh = resolve;
    }));
    mocks.disconnect.mockRejectedValue(new Error("Vault unavailable"));

    renderApp();

    await screen.findByText("Soft Focus");
    fireEvent.click(screen.getByRole("button", { name: "Connection settings" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Bandcamp is connected",
    });
    fireEvent.click(within(dialog).getByRole("button", {
      name: "Disconnect and remove Bandcamp credentials",
    }));
    expect(await within(dialog).findByRole("alert"))
      .toHaveTextContent("Vault unavailable");

    resolveRefresh([{ ...album, title: "Sync still active" }]);
    expect(await screen.findByText("Sync still active")).toBeInTheDocument();
  });
});
