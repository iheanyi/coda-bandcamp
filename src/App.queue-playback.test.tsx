import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Album, Track } from "./types";
import { album, findAudioElement, mocks, renderApp, tracks } from "./test/appTestHarness";

describe("Coda queue and playback flows", { timeout: 10_000 }, () => {

  it("durably saves a changed queue after the structural debounce", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    renderApp();

    await screen.findByText("Soft Focus");
    fireEvent.click(screen.getByRole("button", { name: "Play Soft Focus" }));

    await waitFor(
      () =>
        expect(
          mocks.savePlayerState.mock.calls.at(-1)?.[0].queue.map(
            (track: Track) => track.id,
          ),
        ).toEqual(["track-1", "track-2"]),
      { timeout: 1_500 },
    );
    const savedState = mocks.savePlayerState.mock.calls.at(-1)?.[0];
    expect(savedState).toEqual(
      expect.objectContaining({
        currentIndex: 0,
        queue: [
          expect.objectContaining({ id: "track-1" }),
          expect.objectContaining({ id: "track-2" }),
        ],
      }),
    );
    expect(savedState?.queue).toHaveLength(2);
    expect(savedState?.queue.every((track: Track) => !track.streamUrl)).toBe(
      true,
    );
  });

  it("toggles the queue pane from the dedicated player control", async () => {
    const user = userEvent.setup();
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    renderApp();

    await screen.findByText("Soft Focus");
    const libraryPane = screen.getByRole("main");
    const player = screen.getByRole("contentinfo");
    expect(screen.queryByRole("dialog", { name: "Queue" }))
      .not.toBeInTheDocument();
    const showQueue = screen.getByRole("button", { name: "Show queue" });
    expect(showQueue)
      .toHaveAttribute("aria-pressed", "false");
    showQueue.focus();
    expect(showQueue).toHaveFocus();

    await user.keyboard("{Enter}");
    const queueDrawer = await screen.findByRole("dialog", {
      name: "Queue",
    });
    expect(queueDrawer).toHaveAttribute("id", "queue-drawer");
    expect(showQueue).toHaveAttribute("aria-haspopup", "dialog");
    await waitFor(() => expect(queueDrawer).toHaveFocus());
    expect(within(player).getByRole("slider", { name: "Volume" })).toBeEnabled();
    expect(screen.getByRole("region", { name: "Upcoming tracks" }))
      .toBeInTheDocument();
    const hideQueue = screen.getByRole("button", { name: "Hide queue" });
    expect(hideQueue).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(hideQueue).toHaveAttribute("aria-controls", "queue-drawer");
    expect(screen.getByRole("main")).toBe(libraryPane);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Queue" }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show queue" }))
      .toHaveAttribute("aria-pressed", "false");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Show queue" })).toHaveFocus(),
    );
    expect(screen.getByRole("main")).toBe(libraryPane);
    await user.click(screen.getByRole("button", { name: "Show queue" }));
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Queue" }))
        .toHaveFocus(),
    );
    const keyboardHideQueue = screen.getByRole("button", {
      name: "Hide queue",
    });
    keyboardHideQueue.focus();
    await user.keyboard(" ");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Show queue" })).toHaveFocus(),
    );
  });

  it("keeps a bottom player escape hatch while the queue covers Now Playing", async () => {
    const user = userEvent.setup();
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    renderApp();

    await screen.findByText("Soft Focus");
    await user.click(screen.getByRole("button", { name: "Play Soft Focus" }));
    await user.click(screen.getByRole("link", { name: "Open Now Playing" }));
    const nowPlaying = await screen.findByRole("article", {
      name: "First Light",
    });
    expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();

    const nowPlayingQueueControl = within(nowPlaying).getByRole("button", {
      name: "Show queue",
    });
    nowPlayingQueueControl.focus();
    await user.click(nowPlayingQueueControl);
    expect(await screen.findByRole("dialog", { name: "Queue" }))
      .toBeInTheDocument();

    const queuePlayer = screen.getByRole("contentinfo");
    expect(within(queuePlayer).getAllByRole("button", {
      name: "Hide queue",
    })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Hide queue" })).toHaveLength(1);
    const queueClose = within(queuePlayer).getByRole("button", {
      name: "Hide queue",
    });
    expect(queueClose).toHaveAttribute("aria-controls", "queue-drawer");
    expect(within(queuePlayer).getByRole("button", { name: "Mute" }))
      .toBeEnabled();
    expect(within(queuePlayer).getByRole("slider", { name: "Volume" }))
      .toBeEnabled();
    expect(within(nowPlaying).queryByRole("group", {
      name: "Playback controls",
    })).not.toBeInTheDocument();
    expect(within(nowPlaying).queryByRole("slider", { name: "Volume" }))
      .not.toBeInTheDocument();

    await user.click(within(nowPlaying).getByRole("button", { name: "Back" }));
    const restoredPlayer = screen.getByRole("contentinfo");
    const restoredHideQueue = within(restoredPlayer).getByRole("button", {
      name: "Hide queue",
    });
    await user.click(restoredHideQueue);
    expect(screen.queryByRole("dialog", { name: "Queue" }))
      .not.toBeInTheDocument();
  });

  it("removes a queued track from its keyboard-focusable control", async () => {
    const restoredQueue = tracks.map(
      ({ streamUrl: _streamUrl, ...track }) => track,
    );
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    mocks.loadPlayerState.mockResolvedValue({
      version: 1,
      savedAt: Date.now(),
      queue: restoredQueue,
      currentIndex: 0,
      positionSeconds: 0,
      volume: 0.72,
      repeatMode: "off",
      queueOpen: true,
    });
    renderApp();

    const remove = await screen.findByRole("button", {
      name: "Remove Afterimage",
    });

    remove.focus();
    expect(remove).toHaveFocus();

    fireEvent.click(remove);
    await waitFor(() =>
      expect(screen.queryByRole("button", {
        name: "Remove Afterimage",
      })).not.toBeInTheDocument(),
    );
    expect(within(screen.getByRole("region", {
      name: "Upcoming tracks",
    })).queryByText("Afterimage")).not.toBeInTheDocument();
  });

  it("does not reopen a saved queue drawer without a restorable current track", async () => {
    mocks.loadPlayerState.mockResolvedValue({
      version: 1,
      savedAt: Date.now(),
      queue: [],
      currentIndex: 0,
      positionSeconds: 0,
      volume: 0.72,
      repeatMode: "off",
      queueOpen: true,
    });
    renderApp();

    await waitFor(() => expect(mocks.loadPlayerState).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog", { name: "Queue" }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show queue" }))
      .toHaveAttribute("aria-pressed", "false");
  });

  it("reports the actual native restore failure instead of blaming a pause", async () => {
    const message =
      "Coda could not restore the previous listening session: " +
      "The native player-state contract is temporarily unavailable.";
    mocks.loadPlayerState.mockRejectedValue(
      new Error("The native player-state contract is temporarily unavailable."),
    );
    renderApp();

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });

  it("updates Now Playing and scrobbles after actual listened time", async () => {
    mocks.hasConnection.mockResolvedValue(true);
    const enrichedTrack = {
      ...tracks[0],
      albumArtist: "Night Archive & Guests",
      musicBrainzId: "189002e7-3285-4e2e-92a3-7f6c30d407a2",
    };
    mocks.fetchLibrary.mockResolvedValue([{
      ...album,
      tracks: [enrichedTrack, tracks[1]],
    }]);
    mocks.fetchAlbum.mockResolvedValue([enrichedTrack, tracks[1]]);
    mocks.getLastFmStatus.mockResolvedValue({
      configured: true,
      connected: true,
      username: "nightlistener",
    });
    const { container, queryClient } = renderApp();

    await screen.findByText("Soft Focus");
    expect(
      queryClient.getQueryData<Album[]>(["bandcamp", "library"])?.[0].tracks,
    ).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Connection settings" }));
    const settings = await screen.findByRole("dialog");
    expect(await within(settings).findByText("nightlistener")).toBeInTheDocument();
    fireEvent.click(within(settings).getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Play Soft Focus" }));
    await screen.findByRole("link", { name: "Open Now Playing" });
    const audio = container.querySelector("audio");
    expect(audio).not.toBeNull();
    await waitFor(() => {
      expect(audio).toHaveAttribute("src", enrichedTrack.streamUrl);
    });
    fireEvent.playing(audio!);
    await waitFor(() => expect(mocks.updateLastFmNowPlaying).toHaveBeenCalledOnce());

    for (let position = 10; position <= 90; position += 10) {
      audio!.currentTime = position;
      fireEvent.timeUpdate(audio!);
    }
    await waitFor(() => expect(mocks.scrobbleLastFm).toHaveBeenCalledOnce());
    expect(mocks.scrobbleLastFm.mock.calls[0][0]).toMatchObject({
      artist: "Night Archive",
      title: "First Light",
      album: "Soft Focus",
      albumArtist: "Night Archive & Guests",
      musicBrainzId: "189002e7-3285-4e2e-92a3-7f6c30d407a2",
      chosenByUser: true,
    });
  });

  it("refreshes one failed signed stream before reporting a terminal media error", async () => {
    const restoredTrack = { ...tracks[0], streamUrl: undefined };
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    mocks.loadPlayerState.mockResolvedValue({
      version: 1,
      savedAt: Date.now(),
      queue: [restoredTrack],
      currentIndex: 0,
      positionSeconds: 0,
      volume: 0.72,
      repeatMode: "off",
      queueOpen: false,
    });
    mocks.fetchStreamUrl
      .mockResolvedValueOnce("https://t4.bcbits.com/stream/expired/mp3-128")
      .mockResolvedValueOnce("https://t4.bcbits.com/stream/refreshed/mp3-128");
    const { container } = renderApp();

    const audio = await findAudioElement(container);
    await waitFor(() => {
      expect(audio).toHaveAttribute(
        "src",
        "https://t4.bcbits.com/stream/expired/mp3-128",
      );
    });
    fireEvent.click(await screen.findByRole("button", { name: "Play" }));
    Object.defineProperty(audio, "error", {
      configurable: true,
      value: { code: 2 },
    });

    fireEvent.error(audio);

    await waitFor(() => {
      expect(audio).toHaveAttribute(
        "src",
        "https://t4.bcbits.com/stream/refreshed/mp3-128",
      );
    });
    expect(mocks.fetchStreamUrl).toHaveBeenCalledTimes(2);
    expect(mocks.fetchStreamUrl).toHaveBeenNthCalledWith(1, restoredTrack.id);
    expect(mocks.fetchStreamUrl).toHaveBeenNthCalledWith(2, restoredTrack.id);
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(screen.queryByText("Coda lost the Bandcamp stream connection."))
      .not.toBeInTheDocument();

    fireEvent.error(audio);

    expect(await screen.findByText("Coda lost the Bandcamp stream connection."))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(mocks.fetchStreamUrl).toHaveBeenCalledTimes(2);
  });

  it("lets media-error recovery own a play rejection for the same failed stream", async () => {
    const restoredTrack = { ...tracks[0], streamUrl: undefined };
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    play
      .mockRejectedValueOnce(new Error("The media source failed."))
      .mockResolvedValue(undefined);
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    mocks.loadPlayerState.mockResolvedValue({
      version: 1,
      savedAt: Date.now(),
      queue: [restoredTrack],
      currentIndex: 0,
      positionSeconds: 0,
      volume: 0.72,
      repeatMode: "off",
      queueOpen: false,
    });
    mocks.fetchStreamUrl
      .mockResolvedValueOnce("https://t4.bcbits.com/stream/expired/mp3-128")
      .mockResolvedValueOnce("https://t4.bcbits.com/stream/refreshed/mp3-128");

    try {
      const { container } = renderApp();
      const audio = await findAudioElement(container);
      await waitFor(() => {
        expect(audio).toHaveAttribute(
          "src",
          "https://t4.bcbits.com/stream/expired/mp3-128",
        );
      });
      Object.defineProperty(audio, "error", {
        configurable: true,
        value: { code: 2 },
      });

      fireEvent.click(await screen.findByRole("button", { name: "Play" }));
      fireEvent.error(audio);

      await waitFor(() => {
        expect(audio).toHaveAttribute(
          "src",
          "https://t4.bcbits.com/stream/refreshed/mp3-128",
        );
      });
      expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
      expect(screen.queryByText(/Coda could not start playback/)).not.toBeInTheDocument();
      expect(mocks.fetchStreamUrl).toHaveBeenNthCalledWith(2, restoredTrack.id);
    } finally {
      play.mockReset().mockResolvedValue(undefined);
    }
  });
});
