import {
  act,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { radioShowQueryOptions } from "@/queries/radioQueries";
import type { PlayerStateSnapshot } from "@/types";

import {
  controllerFrom,
  mocks,
  persistedTrack,
  playerState,
  refreshedRadioShow,
  renderRuntime,
  tracks,
} from "./playbackRuntimeTestHarness";

const staleRadioStreamUrl =
  "https://t4.bcbits.com/stream/radio-979-cached/mp3-128";

function persistedRadioShowTrack(): PlayerStateSnapshot["queue"][number] {
  return persistedTrack({
    ...tracks[0],
    id: "radio:979",
    title: "The Coda Broadcast",
    artist: "Bandcamp Radio",
    album: "Bandcamp Weekly",
    albumId: "radio:979",
    duration: 3_600,
    track: 1,
  });
}

describe("Playback runtime Radio reacquisition", () => {
  it("fetches a live signed Radio stream on restore despite a warm show cache", async () => {
    mocks.loadPlayerState.mockResolvedValue(
      playerState([persistedRadioShowTrack()], { positionSeconds: 60 }),
    );
    const { container, current } = renderRuntime({
      connected: false,
      lastFmConnected: false,
      prepareQueryClient: (queryClient) => {
        queryClient.setQueryData(radioShowQueryOptions(979).queryKey, {
          ...refreshedRadioShow,
          streamUrl: staleRadioStreamUrl,
        });
      },
    });
    const audio = container.querySelector<HTMLAudioElement>("audio")!;

    await waitFor(() =>
      expect(audio).toHaveAttribute("src", refreshedRadioShow.streamUrl),
    );
    expect(audio).not.toHaveAttribute("src", staleRadioStreamUrl);
    expect(mocks.fetchRadioShow).toHaveBeenCalledWith(979);
    expect(mocks.fetchStreamUrl).not.toHaveBeenCalled();
    expect(controllerFrom(current).queue.currentTrack).not.toHaveProperty(
      "streamUrl",
    );
    expect(controllerFrom(current).queue.currentRadioTimeline).toEqual(
      refreshedRadioShow.chapters,
    );
  });

  it("reacquires Radio media once after an expired signed stream error", async () => {
    mocks.fetchRadioShow
      .mockResolvedValueOnce({
        ...refreshedRadioShow,
        streamUrl: staleRadioStreamUrl,
      })
      .mockResolvedValue(refreshedRadioShow);
    mocks.loadPlayerState.mockResolvedValue(
      playerState([persistedRadioShowTrack()]),
    );
    const { container, current, notify } = renderRuntime({
      connected: false,
      lastFmConnected: true,
    });
    const audio = container.querySelector<HTMLAudioElement>("audio")!;

    await waitFor(() =>
      expect(audio).toHaveAttribute("src", staleRadioStreamUrl),
    );
    expect(mocks.fetchRadioShow).toHaveBeenCalledTimes(1);
    act(() => controllerFrom(current).transportCommands.play());
    Object.defineProperty(audio, "error", {
      configurable: true,
      value: { code: 2 },
    });

    fireEvent.error(audio);
    await waitFor(() =>
      expect(audio).toHaveAttribute("src", refreshedRadioShow.streamUrl),
    );
    expect(mocks.fetchRadioShow).toHaveBeenCalledTimes(2);
    expect(controllerFrom(current).transport.playing).toBe(true);
    expect(controllerFrom(current).queue.currentRadioTimeline[1]?.title).toBe(
      "Second signal",
    );

    Object.defineProperty(audio, "duration", {
      configurable: true,
      value: 3_600,
    });
    audio.currentTime = 60;
    fireEvent.timeUpdate(audio);
    await waitFor(() =>
      expect(mocks.updateLastFmNowPlaying).toHaveBeenCalledWith(
        expect.objectContaining({
          artist: "Night Archive",
          title: "Second signal",
          chosenByUser: false,
        }),
      ),
    );

    fireEvent.error(audio);
    await waitFor(() =>
      expect(controllerFrom(current).transport.playing).toBe(false),
    );
    expect(mocks.fetchRadioShow).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledWith(
      "Coda lost the Bandcamp stream connection.",
      "bad",
    );
    expect(mocks.scrobbleLastFm).not.toHaveBeenCalled();
  });

  it("retries a failed Radio reacquisition when the current item is reactivated", async () => {
    mocks.fetchRadioShow
      .mockRejectedValueOnce(new Error("Radio show unavailable"))
      .mockResolvedValue(refreshedRadioShow);
    mocks.loadPlayerState.mockResolvedValue(
      playerState([persistedRadioShowTrack()]),
    );
    const { container, current, notify } = renderRuntime({
      connected: false,
      lastFmConnected: false,
    });
    const audio = container.querySelector<HTMLAudioElement>("audio")!;

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        expect.stringContaining("Coda could not resume this Radio show"),
        "bad",
      ),
    );
    expect(audio.getAttribute("src")).toBeNull();
    expect(mocks.fetchRadioShow).toHaveBeenCalledTimes(1);

    act(() => controllerFrom(current).queueCommands.playQueueIndex(0));
    await waitFor(() =>
      expect(audio).toHaveAttribute("src", refreshedRadioShow.streamUrl),
    );
    expect(mocks.fetchRadioShow).toHaveBeenCalledTimes(2);
    expect(controllerFrom(current).queue.currentRadioTimeline).toHaveLength(2);
    expect(controllerFrom(current).queue.queue).toHaveLength(1);
  });
});
