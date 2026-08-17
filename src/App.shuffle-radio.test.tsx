import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { albumQueryKey } from "./libraryQueries";
import type { Album, Track } from "./types";
import { album, deferred, findAudioElement, mocks, renderApp, single, startArtistShuffle, tracks } from "./test/appTestHarness";

describe("Coda shuffle and Radio playback flows", () => {

  it("can surprise with a complete album from the current browsing context", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album, single]);
    let random: ReturnType<typeof vi.spyOn> | undefined;
    try {
      renderApp();

      await screen.findByText("Soft Focus");
      random = vi.spyOn(Math, "random").mockReturnValue(0);
      fireEvent.click(screen.getByRole("button", {
        name: "Surprise me from the collection",
      }));

      expect(await screen.findByRole("link", { name: "Open Now Playing" }))
        .toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Show queue" }));
      expect(await screen.findByText("1 track next")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Shuffle collection" }),
      ).toBeInTheDocument();
    } finally {
      random?.mockRestore();
    }
  });

  it("hydrates only the selected release for an album surprise", async () => {
    const coldAlbums = Array.from({ length: 3 }, (_, index): Album => ({
      ...album,
      id: `cold-surprise-${index}`,
      title: `Cold Surprise ${index}`,
      tracks: undefined,
    }));
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue(coldAlbums);
    mocks.fetchAlbum.mockImplementation(async (selected: Album) =>
      tracks.map((item) => ({
        ...item,
        id: `${selected.id}-${item.id}`,
        album: selected.title,
        albumId: selected.id,
      }))
    );
    let random: ReturnType<typeof vi.spyOn> | undefined;
    try {
      renderApp();

      await screen.findByText("Cold Surprise 0");
      random = vi.spyOn(Math, "random").mockReturnValue(0);
      fireEvent.click(screen.getByRole("button", {
        name: "Surprise me from the collection",
      }));

      expect(await screen.findByRole("link", { name: "Open Now Playing" }))
        .toBeInTheDocument();
      expect(mocks.fetchAlbum).toHaveBeenCalledOnce();
      fireEvent.click(screen.getByRole("button", { name: "Show queue" }));
      expect(await screen.findByText("1 track next")).toBeInTheDocument();
    } finally {
      random?.mockRestore();
    }
  });

  it("can surprise with one weighted track and replaces the queue", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album, single]);
    const randomValues = [0.75, 0.9, 0.2, 0.75];
    let random: ReturnType<typeof vi.spyOn> | undefined;
    try {
      renderApp();

      await screen.findByText("Soft Focus");
      random = vi.spyOn(Math, "random").mockImplementation(
        () => randomValues.shift() ?? 0,
      );
      fireEvent.click(screen.getByRole("button", {
        name: "Surprise me from the collection",
      }));

      expect(await screen.findByRole("link", { name: "Open Now Playing" }))
        .toBeInTheDocument();
      expect(screen.getAllByText("Afterimage").length).toBeGreaterThan(0);
      fireEvent.click(screen.getByRole("button", { name: "Show queue" }));
      expect(await screen.findByText("End of the queue")).toBeInTheDocument();
      expect(screen.queryByText("First Light")).not.toBeInTheDocument();
    } finally {
      random?.mockRestore();
    }
  });

  it("bounds unavailable Surprise Me attempts", async () => {
    const unavailableAlbums: Album[] = Array.from(
      { length: 9 },
      (_, index) => ({
        id: `unavailable-${index}`,
        title: `Unavailable ${index}`,
        artist: "Offline Archive",
        songCount: 1,
        duration: 0,
        palette: ["#777", "#222"],
      }),
    );
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue(unavailableAlbums);
    mocks.fetchAlbum.mockResolvedValue([]);
    renderApp();

    await screen.findByText("Unavailable 0");
    fireEvent.click(screen.getByRole("button", {
      name: "Surprise me from the collection",
    }));

    await waitFor(() => expect(mocks.fetchAlbum).toHaveBeenCalledTimes(6));
    expect(await screen.findByText(
      "No playable music was found in the collection.",
    )).toBeInTheDocument();
  });

  it("starts a contextual shuffle before progressively hydrating the next release", async () => {
    const shuffleAlbums: Album[] = ["one", "two"].map((suffix) => ({
      ...album,
      id: `shuffle-album-${suffix}`,
      title: `Shuffle Album ${suffix}`,
      songCount: 1,
      duration: 180,
      tracks: undefined,
    }));
    const shuffleTracks = new Map(shuffleAlbums.map((release, index) => [
      release.id,
      [{
        ...tracks[0],
        id: `shuffle-track-${index + 1}`,
        title: `Shuffle Track ${index + 1}`,
        album: release.title,
        albumId: release.id,
      }],
    ]));
    const requests = new Map(shuffleAlbums.map((release) => [
      release.id,
      deferred<Track[]>(),
    ]));
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue(shuffleAlbums);
    mocks.fetchAlbum.mockImplementation((release: Album) =>
      requests.get(release.id)!.promise
    );
    renderApp();

    await screen.findByText("Shuffle Album one");
    await startArtistShuffle();
    await waitFor(() => expect(mocks.fetchAlbum).toHaveBeenCalledTimes(2));

    const firstRelease = mocks.fetchAlbum.mock.calls[0][0];
    const secondRelease = mocks.fetchAlbum.mock.calls[1][0];
    await act(async () => {
      requests.get(secondRelease.id)!.resolve(shuffleTracks.get(secondRelease.id)!);
    });
    expect(screen.queryByRole("link", { name: "Open Now Playing" }))
      .not.toBeInTheDocument();

    await act(async () => {
      requests.get(firstRelease.id)!.resolve(shuffleTracks.get(firstRelease.id)!);
    });

    expect(await screen.findByRole("link", { name: "Open Now Playing" }))
      .toBeInTheDocument();
    expect(screen.getAllByText(shuffleTracks.get(firstRelease.id)![0].title).length)
      .toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByRole("button", {
      name: "Shuffle",
    })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: "Show queue" }));
    expect(await screen.findByText("1 track next")).toBeInTheDocument();
  });

  it("advances into a progressively loaded shuffle tail without stopping playback", async () => {
    const shuffleAlbums: Album[] = ["one", "two"].map((suffix) => ({
      ...album,
      id: `tail-shuffle-album-${suffix}`,
      title: `Tail Shuffle Album ${suffix}`,
      songCount: 1,
      tracks: undefined,
    }));
    const requests = new Map(shuffleAlbums.map((release) => [
      release.id,
      deferred<Track[]>(),
    ]));
    const trackFor = (release: Album): Track => ({
      ...tracks[0],
      id: `tail-${release.id}`,
      title: `Track for ${release.title}`,
      album: release.title,
      albumId: release.id,
    });
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue(shuffleAlbums);
    mocks.fetchAlbum.mockImplementation((release: Album) =>
      requests.get(release.id)!.promise
    );
    renderApp();

    await screen.findByText("Tail Shuffle Album one");
    await startArtistShuffle();
    await waitFor(() => expect(mocks.fetchAlbum).toHaveBeenCalledTimes(2));
    const firstRelease = mocks.fetchAlbum.mock.calls[0][0];
    await act(async () => {
      requests.get(firstRelease.id)!.resolve([trackFor(firstRelease)]);
    });
    expect(await screen.findByRole("button", { name: "Pause" }))
      .toBeInTheDocument();

    const secondRelease = mocks.fetchAlbum.mock.calls[1][0];
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await act(async () => {
      requests.get(secondRelease.id)!.resolve([trackFor(secondRelease)]);
    });

    await within(screen.getByRole("contentinfo")).findByText(
      trackFor(secondRelease).title,
    );
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
  });

  it("wraps deferred manual Next when the remaining shuffle tail is empty", async () => {
    const shuffleAlbums: Album[] = Array.from({ length: 6 }, (_, index) => ({
      ...album,
      id: `empty-tail-album-${index}`,
      title: `Empty Tail Album ${index}`,
      songCount: 1,
      tracks: undefined,
    }));
    const requests = new Map(shuffleAlbums.map((release) => [
      release.id,
      deferred<Track[]>(),
    ]));
    const trackFor = (release: Album): Track => ({
      ...tracks[0],
      id: `empty-tail-${release.id}`,
      title: `Track for ${release.title}`,
      album: release.title,
      albumId: release.id,
    });
    const releaseAtCall = (index: number) =>
      mocks.fetchAlbum.mock.calls[index][0];
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue(shuffleAlbums);
    mocks.fetchAlbum.mockImplementation((release: Album) =>
      requests.get(release.id)!.promise
    );
    renderApp();

    await screen.findByText("Empty Tail Album 0");
    await startArtistShuffle();
    await waitFor(() => expect(mocks.fetchAlbum).toHaveBeenCalledTimes(4));
    const firstRelease = releaseAtCall(0);
    await act(async () => {
      requests.get(firstRelease.id)!.resolve([trackFor(firstRelease)]);
    });
    expect(await screen.findByRole("button", { name: "Pause" }))
      .toBeInTheDocument();

    await waitFor(() => expect(mocks.fetchAlbum).toHaveBeenCalledTimes(5));

    await act(async () => {
      for (let index = 1; index <= 4; index += 1) {
        const release = releaseAtCall(index);
        requests.get(release.id)!.resolve([trackFor(release)]);
      }
    });
    fireEvent.click(screen.getByRole("button", { name: "Show queue" }));
    expect(await screen.findByText("4 tracks next")).toBeInTheDocument();
    const player = screen.getByRole("contentinfo");
    fireEvent.click(within(player).getByRole("button", { name: "Repeat off" }));
    for (let index = 0; index < 4; index += 1) {
      fireEvent.click(within(player).getByRole("button", { name: "Next" }));
    }
    const lastPlayableRelease = releaseAtCall(4);
    await within(player).findByText(trackFor(lastPlayableRelease).title);

    fireEvent.click(within(player).getByRole("button", { name: "Next" }));
    await waitFor(() => expect(mocks.fetchAlbum).toHaveBeenCalledTimes(6));
    const emptyRelease = releaseAtCall(5);
    await act(async () => {
      requests.get(emptyRelease.id)!.resolve([]);
    });

    await within(player).findByText(trackFor(firstRelease).title);
    expect(within(player).getByRole("button", { name: "Pause" }))
      .toBeInTheDocument();
  });

  it("keeps playback paused when deferred manual Next receives a track", async () => {
    const shuffleAlbums: Album[] = Array.from({ length: 2 }, (_, index) => ({
      ...album,
      id: `paused-tail-album-${index}`,
      title: `Paused Tail Album ${index}`,
      songCount: 1,
      tracks: undefined,
    }));
    const requests = new Map(shuffleAlbums.map((release) => [
      release.id,
      deferred<Track[]>(),
    ]));
    const trackFor = (release: Album): Track => ({
      ...tracks[0],
      id: `paused-tail-${release.id}`,
      title: `Track for ${release.title}`,
      album: release.title,
      albumId: release.id,
    });
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue(shuffleAlbums);
    mocks.fetchAlbum.mockImplementation((release: Album) =>
      requests.get(release.id)!.promise
    );
    renderApp();

    await screen.findByText("Paused Tail Album 0");
    await startArtistShuffle();
    await waitFor(() => expect(mocks.fetchAlbum).toHaveBeenCalledTimes(2));
    const firstRelease = mocks.fetchAlbum.mock.calls[0][0];
    await act(async () => {
      requests.get(firstRelease.id)!.resolve([trackFor(firstRelease)]);
    });
    fireEvent.click(await screen.findByRole("button", { name: "Pause" }));
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    const secondRelease = mocks.fetchAlbum.mock.calls[1][0];
    await act(async () => {
      requests.get(secondRelease.id)!.resolve([trackFor(secondRelease)]);
    });

    await within(screen.getByRole("contentinfo")).findByText(
      trackFor(secondRelease).title,
    );
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
  });

  it("moves cached track metadata into shuffle without refetching or resolving future streams", async () => {
    const cachedAlbum: Album = {
      ...album,
      id: "cached-shuffle-album",
      title: "Cached Shuffle Album",
      songCount: 13,
      tracks: undefined,
    };
    const cachedTracks = Array.from({ length: 13 }, (_, index): Track => ({
      ...tracks[0],
      id: `cached-shuffle-track-${index}`,
      title: `Cached Shuffle Track ${index}`,
      album: cachedAlbum.title,
      albumId: cachedAlbum.id,
      streamUrl: undefined,
    }));
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([cachedAlbum]);
    const { queryClient } = renderApp();

    await screen.findByText(cachedAlbum.title);
    queryClient.setQueryData(albumQueryKey(cachedAlbum.id), cachedTracks);
    mocks.fetchAlbum.mockClear();
    mocks.fetchStreamUrl.mockClear();
    await startArtistShuffle();

    expect(await screen.findByRole("link", { name: "Open Now Playing" }))
      .toBeInTheDocument();
    expect(mocks.fetchAlbum).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.fetchStreamUrl).toHaveBeenCalledOnce());
    expect(cachedTracks.map((track) => track.id)).toContain(
      mocks.fetchStreamUrl.mock.calls[0][0],
    );

    fireEvent.click(screen.getByRole("button", { name: "Show queue" }));
    expect(await screen.findByText("12 tracks next")).toBeInTheDocument();
    expect(mocks.fetchStreamUrl).toHaveBeenCalledOnce();
  });

  it("keeps streaming shuffled metadata into the queue without advancing playback", async () => {
    const shuffleAlbums: Album[] = Array.from({ length: 20 }, (_, index) => ({
      ...album,
      id: `streamed-shuffle-album-${index}`,
      title: `Streamed Shuffle Album ${index}`,
      songCount: 1,
      tracks: undefined,
    }));
    const trackFor = (release: Album): Track => ({
      ...tracks[0],
      id: `streamed-${release.id}`,
      title: `Track for ${release.title}`,
      album: release.title,
      albumId: release.id,
      streamUrl: undefined,
    });
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue(shuffleAlbums);
    mocks.fetchAlbum.mockImplementation(async (release: Album) =>
      [trackFor(release)]
    );
    renderApp();

    await screen.findByText("Streamed Shuffle Album 0");
    await startArtistShuffle();

    await waitFor(() => expect(mocks.fetchAlbum).toHaveBeenCalledTimes(20));
    fireEvent.click(screen.getByRole("button", { name: "Show queue" }));
    await waitFor(() => {
      expect(screen.getByText(/tracks next/)).toHaveTextContent(
        "19 tracks next",
      );
    });
    await waitFor(() => expect(mocks.fetchStreamUrl).toHaveBeenCalledOnce());
  });

  it("bounds parallel shuffle hydration and ignores late results after Clear next", async () => {
    const shuffleAlbums: Album[] = Array.from({ length: 9 }, (_, index) => ({
      ...album,
      id: `bounded-shuffle-album-${index}`,
      title: `Bounded Shuffle Album ${index}`,
      songCount: 1,
      tracks: undefined,
    }));
    const requests = new Map(shuffleAlbums.map((release) => [
      release.id,
      deferred<Track[]>(),
    ]));
    const trackFor = (release: Album): Track => ({
      ...tracks[0],
      id: `bounded-${release.id}`,
      title: `Track for ${release.title}`,
      album: release.title,
      albumId: release.id,
    });
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue(shuffleAlbums);
    mocks.fetchAlbum.mockImplementation((release: Album) =>
      requests.get(release.id)!.promise
    );
    renderApp();

    await screen.findByText("Bounded Shuffle Album 0");
    await startArtistShuffle();
    await waitFor(() => expect(mocks.fetchAlbum).toHaveBeenCalledTimes(4));
    const firstRelease = mocks.fetchAlbum.mock.calls[0][0];
    await act(async () => {
      requests.get(firstRelease.id)!.resolve([trackFor(firstRelease)]);
    });
    expect(await screen.findByRole("link", { name: "Open Now Playing" }))
      .toBeInTheDocument();

    await waitFor(() => expect(mocks.fetchAlbum).toHaveBeenCalledTimes(5));
    expect(mocks.fetchAlbum).toHaveBeenCalledTimes(5);
    fireEvent.click(screen.getByRole("button", { name: "Show queue" }));
    expect(await screen.findByText("Loading more tracks…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear next" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Clear next" }));

    await act(async () => {
      for (const [requestedAlbum] of mocks.fetchAlbum.mock.calls.slice(1)) {
        requests.get(requestedAlbum.id)!.resolve([trackFor(requestedAlbum)]);
      }
    });
    await waitFor(() => {
      expect(screen.getByText("End of the queue")).toBeInTheDocument();
    });
    expect(mocks.fetchAlbum).toHaveBeenCalledTimes(5);
  });

  it("restores the saved queue paused and applies its position after media metadata loads", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    mocks.loadPlayerState.mockResolvedValue({
      version: 1,
      savedAt: Date.now(),
      queue: tracks.map(({ streamUrl: _streamUrl, artworkUrl: _artworkUrl, ...track }) => track),
      currentIndex: 1,
      positionSeconds: 42,
      volume: 0.44,
      repeatMode: "one",
      queueOpen: false,
      lastFmProgress: {
        trackId: "track-2",
        startedAt: 0,
        listenedSeconds: 80,
        lastPosition: 42,
        nowPlayingSent: false,
        scrobbleState: "sent",
      },
    });
    const { container } = renderApp();

    expect(await screen.findByRole("link", { name: "Open Now Playing" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show queue" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getAllByText("Afterimage").length).toBeGreaterThan(0);
    await waitFor(() => expect(mocks.fetchStreamUrl).toHaveBeenCalledWith("track-2"));

    const audio = container.querySelector("audio");
    expect(audio).not.toBeNull();
    Object.defineProperty(audio!, "duration", {
      configurable: true,
      value: 210,
    });
    fireEvent.loadedMetadata(audio!);
    expect(audio!.currentTime).toBe(42);
    expect(screen.getByRole("slider", { name: "Track position" }))
      .toHaveValue("42");
  });

  it("refreshes a restored Radio show and resumes its saved playhead without a connection", async () => {
    mocks.hasConnection.mockResolvedValue(false);
    mocks.loadPlayerState.mockResolvedValue({
      version: 1,
      savedAt: Date.now(),
      queue: [{
        id: "radio:979",
        title: "The Coda Broadcast",
        artist: "Bandcamp Radio",
        album: "Bandcamp Weekly",
        albumId: "radio:979",
        duration: 3_600,
        track: 1,
        palette: ["#ca6954", "#241b1a"],
      }],
      currentIndex: 0,
      positionSeconds: 65,
      volume: 0.7,
      repeatMode: "off",
      queueOpen: false,
      radioScrobbleProgress: {
        showTrackId: "radio:979",
        activeChapterKey: "60:chapter",
        chapterStartedAt: 0,
        chapterListenedSeconds: 5,
        lastPosition: 65,
        chapterNowPlayingSent: false,
        chapterScrobbleState: "idle",
        showStartedAt: 0,
        showListenedSeconds: 65,
        showScrobbleState: "idle",
        scrobbledChapterKeys: [],
      },
    });
    const { container } = renderApp();

    await waitFor(() => expect(mocks.fetchRadioShow).toHaveBeenCalledWith(979));
    await waitFor(() =>
      expect(container.querySelector("audio")).toHaveAttribute(
        "src",
        "https://t4.bcbits.com/stream/radio-979-refreshed/mp3-128",
      ),
    );
    expect(screen.getAllByText("Second signal").length).toBeGreaterThan(0);
    expect(
      document.querySelector("[data-coda-now-playing-title-compact]"),
    ).not.toBeInTheDocument();
    expect(mocks.fetchStreamUrl).not.toHaveBeenCalledWith("radio:979");

    const audio = await findAudioElement(container);
    Object.defineProperty(audio, "duration", {
      configurable: true,
      value: 3_600,
    });
    fireEvent.loadedMetadata(audio);
    expect(audio.currentTime).toBe(65);
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    await waitFor(() =>
      expect(mocks.checkpointPlayerState).toHaveBeenCalledWith(
        expect.objectContaining({
          currentTrackId: "radio:979",
          positionSeconds: 65,
          radioScrobbleProgress: expect.objectContaining({
            showTrackId: "radio:979",
            showListenedSeconds: 65,
          }),
        }),
      ),
    );
    fireEvent.click(screen.getByRole("link", { name: "Open Now Playing" }));
    expect(
      document.querySelector("[data-coda-now-playing-title-detail]"),
    ).not.toBeInTheDocument();
  });

  it("navigates from Now Playing to Radio without snapshotting mismatched artwork", async () => {
    mocks.hasConnection.mockResolvedValue(false);
    mocks.fetchRadioShow.mockResolvedValue({
      id: 979,
      subtitle: "The Coda Broadcast",
      title: "The Hip Hop Show",
      description: "A broadcast from Bandcamp.",
      publishedAt: "2026-07-20T12:00:00Z",
      duration: 3_600,
      streamUrl: "https://t4.bcbits.com/stream/radio-979-refreshed/mp3-128",
      artworkUrl: "https://f4.bcbits.com/img/radio-979.jpg",
      series: {
        id: 5,
        title: "The Hip Hop Show",
        slug: "the-hip-hop-show",
      },
      chapters: [
        { title: "Opening signal", artist: "Bandcamp Radio", timecode: 0 },
        {
          title: "Second signal",
          artist: "Night Archive",
          timecode: 60,
          artworkUrl: "https://f4.bcbits.com/img/second-signal.jpg",
        },
      ],
    });
    mocks.loadPlayerState.mockResolvedValue({
      version: 1,
      savedAt: Date.now(),
      queue: [{
        id: "radio:979",
        title: "The Coda Broadcast",
        artist: "Bandcamp Radio",
        album: "The Hip Hop Show",
        albumId: "radio:979",
        duration: 3_600,
        track: 1,
        palette: ["#ca6954", "#241b1a"],
      }],
      currentIndex: 0,
      positionSeconds: 65,
      volume: 0.7,
      repeatMode: "off",
      queueOpen: false,
    });
    renderApp();

    await waitFor(() => expect(mocks.fetchRadioShow).toHaveBeenCalledWith(979));
    fireEvent.click(await screen.findByRole("link", {
      name: "Open Now Playing",
    }));
    const nowPlaying = await screen.findByRole("article");
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
      fireEvent.click(within(nowPlaying).getByRole("link", {
        name: "Bandcamp Radio",
      }));

      const radioNavigation = await screen.findByRole("navigation", {
        name: "Bandcamp Radio shows",
      });
      expect(within(radioNavigation).getByRole("link", {
        name: "All shows",
      })).toHaveAttribute("aria-current", "page");
      expect(startViewTransition).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(mocks.fetchRadioShows).toHaveBeenCalledWith({
          cursor: undefined,
          seriesId: undefined,
        }),
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

  it("uses player Previous and Next as Radio chapter transport before changing queue items", async () => {
    mocks.fetchRadioShow.mockResolvedValue({
      id: 979,
      subtitle: "The Coda Broadcast",
      title: "Bandcamp Weekly",
      description: "A broadcast from Bandcamp.",
      publishedAt: "2026-07-20T12:00:00Z",
      duration: 3_600,
      streamUrl: "https://t4.bcbits.com/stream/radio-979-refreshed/mp3-128",
      chapters: [
        { title: "Opening signal", artist: "Bandcamp Radio", timecode: 0 },
        { title: "Second signal", artist: "Night Archive", timecode: 60 },
        { title: "Final signal", artist: "Signal Path", timecode: 120 },
      ],
    });
    mocks.loadPlayerState.mockResolvedValue({
      version: 1,
      savedAt: Date.now(),
      queue: [
        {
          id: "radio:979",
          title: "The Coda Broadcast",
          artist: "Bandcamp Radio",
          album: "Bandcamp Weekly",
          albumId: "radio:979",
          duration: 3_600,
          track: 1,
          palette: ["#ca6954", "#241b1a"],
        },
        tracks[0],
      ],
      currentIndex: 0,
      positionSeconds: 65,
      volume: 0.7,
      repeatMode: "off",
      queueOpen: false,
    });
    const { container } = renderApp();

    await waitFor(() => expect(mocks.fetchRadioShow).toHaveBeenCalledWith(979));
    const audio = await findAudioElement(container);
    Object.defineProperty(audio, "duration", {
      configurable: true,
      value: 3_600,
    });
    fireEvent.loadedMetadata(audio);
    expect(audio.currentTime).toBe(65);
    expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(audio.currentTime).toBe(120);

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(audio.currentTime).toBe(60);

    audio.currentTime = 120;
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findAllByText("First Light")).not.toHaveLength(0);
    expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("scrobbles Radio chapters and the completed show as separate radio selections", async () => {
    mocks.getLastFmStatus.mockResolvedValue({
      configured: true,
      connected: true,
      username: "nightlistener",
    });
    mocks.loadPlayerState.mockResolvedValue({
      version: 1,
      savedAt: Date.now(),
      queue: [{
        id: "radio:979",
        title: "The Coda Broadcast",
        artist: "Bandcamp Radio",
        album: "Bandcamp Weekly",
        albumId: "radio:979",
        duration: 3_600,
        track: 1,
        palette: ["#ca6954", "#241b1a"],
      }],
      currentIndex: 0,
      positionSeconds: 60,
      volume: 0.7,
      repeatMode: "off",
      queueOpen: false,
    });
    const { container } = renderApp();

    await waitFor(() => expect(mocks.fetchRadioShow).toHaveBeenCalledWith(979));
    const audio = await findAudioElement(container);
    Object.defineProperty(audio, "duration", {
      configurable: true,
      value: 3_600,
    });
    fireEvent.loadedMetadata(audio);
    fireEvent.click(await screen.findByRole("button", { name: "Play" }));
    fireEvent.playing(audio);
    await waitFor(() => expect(mocks.updateLastFmNowPlaying).toHaveBeenCalledWith(
      expect.objectContaining({
        artist: "Night Archive",
        title: "Second signal",
        chosenByUser: false,
      }),
    ));

    for (let position = 70; position <= 300; position += 10) {
      audio.currentTime = position;
      fireEvent.timeUpdate(audio);
    }
    await waitFor(() => expect(mocks.scrobbleLastFm).toHaveBeenCalledTimes(1));
    expect(mocks.scrobbleLastFm.mock.calls[0][0]).toMatchObject({
      artist: "Night Archive",
      title: "Second signal",
      chosenByUser: false,
    });

    audio.currentTime = 3_600;
    fireEvent.ended(audio);
    await waitFor(() => expect(mocks.scrobbleLastFm).toHaveBeenCalledTimes(2));
    expect(mocks.scrobbleLastFm.mock.calls[1][0]).toMatchObject({
      artist: "Bandcamp Radio",
      title: "The Coda Broadcast",
      chosenByUser: false,
    });
  });

  it("retains a large restored queue while bounding upcoming track rendering", async () => {
    const largeQueue = Array.from({ length: 300 }, (_, index): Track => ({
      ...tracks[0],
      id: `large-track-${index}`,
      title: `Large queue track ${index}`,
      track: index + 1,
      streamUrl: undefined,
    }));
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    mocks.loadPlayerState.mockResolvedValue({
      version: 1,
      savedAt: Date.now(),
      queue: largeQueue,
      currentIndex: 0,
      positionSeconds: 0,
      volume: 0.72,
      repeatMode: "off",
      queueOpen: true,
    });
    renderApp();

    const queueRegion = await screen.findByRole("region", {
      name: "Upcoming tracks",
    });
    expect(within(queueRegion).queryAllByRole("listitem").length).toBeLessThan(40);
    expect(screen.queryByText("Large queue track 299")).not.toBeInTheDocument();
    expect(screen.getByText("299 tracks next")).toBeInTheDocument();
  });
});
