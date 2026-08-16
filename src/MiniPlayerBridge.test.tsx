import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createPlaybackClock } from "./playbackClock";
import type {
  MiniPlayerSnapshot,
  MiniPlayerWireValue,
} from "./miniPlayer";
import {
  MiniPlayerBridge,
  type MiniPlayerEventBridge,
} from "./MiniPlayerBridge";
import type { Track } from "./types";

class MemoryMiniPlayerBridge implements MiniPlayerEventBridge {
  snapshots: MiniPlayerSnapshot[] = [];
  requestState?: () => void;
  command?: (payload: MiniPlayerWireValue) => void;
  requestDisposed = vi.fn();
  commandDisposed = vi.fn();

  emitSnapshot = async (snapshot: MiniPlayerSnapshot) => {
    this.snapshots.push(snapshot);
  };

  listenForRequest = async (handler: () => void) => {
    this.requestState = handler;
    return this.requestDisposed;
  };

  listenForCommand = async (
    handler: (payload: MiniPlayerWireValue) => void,
  ) => {
    this.command = handler;
    return this.commandDisposed;
  };
}

const track: Track = {
  id: "track-1",
  title: "First Light",
  artist: "Night Archive",
  album: "Soft Focus",
  albumId: "album-1",
  duration: 180,
  track: 1,
  artworkUrl: "https://t4.bcbits.com/img/cover.jpg",
  streamUrl: "https://t4.bcbits.com/stream/signed.mp3",
  palette: ["#dd6549", "#202326"],
};

describe("main-to-mini player bridge", () => {
  it("mirrors the clock, routes bounded commands, and disposes listeners", async () => {
    const eventBridge = new MemoryMiniPlayerBridge();
    const playbackClock = createPlaybackClock(42);
    const onTogglePlayback = vi.fn();
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    const onSeek = vi.fn();
    const onSetVolume = vi.fn();
    const onShowMain = vi.fn();

    const view = render(
      <MiniPlayerBridge
        eventBridge={eventBridge}
        track={track}
        radioTimeline={[]}
        playbackClock={playbackClock}
        playing
        durationSeconds={180}
        volume={0.72}
        canPrevious
        canNext={false}
        onTogglePlayback={onTogglePlayback}
        onPrevious={onPrevious}
        onNext={onNext}
        onSeek={onSeek}
        onSetVolume={onSetVolume}
        onShowMain={onShowMain}
      />,
    );

    await waitFor(() => expect(eventBridge.snapshots).toHaveLength(1));
    expect(eventBridge.snapshots[0]).toMatchObject({
      track: {
        id: "track-1",
        title: "First Light",
        artist: "Night Archive",
      },
      playing: true,
      positionSeconds: 42,
      durationSeconds: 180,
      volume: 0.72,
      canPrevious: true,
      canNext: false,
    });
    expect(JSON.stringify(eventBridge.snapshots[0])).not.toContain(
      "signed.mp3",
    );

    act(() => playbackClock.updateFromMedia(43.4));
    await waitFor(() =>
      expect(eventBridge.snapshots.at(-1)?.positionSeconds).toBe(43),
    );

    act(() => eventBridge.requestState?.());
    await waitFor(() => expect(eventBridge.snapshots).toHaveLength(3));

    act(() => {
      eventBridge.command?.({ type: "play-pause" });
      eventBridge.command?.({ type: "previous" });
      eventBridge.command?.({ type: "next" });
      eventBridge.command?.({ type: "seek", positionSeconds: 73 });
      eventBridge.command?.({ type: "volume", volume: 0.35 });
      eventBridge.command?.({ type: "show-main" });
      eventBridge.command?.({ type: "volume", volume: 4 });
    });

    expect(onTogglePlayback).toHaveBeenCalledOnce();
    expect(onPrevious).toHaveBeenCalledOnce();
    expect(onNext).toHaveBeenCalledOnce();
    expect(onSeek).toHaveBeenCalledExactlyOnceWith(73);
    expect(onSetVolume).toHaveBeenCalledExactlyOnceWith(0.35);
    expect(onShowMain).toHaveBeenCalledOnce();

    view.unmount();
    expect(eventBridge.requestDisposed).toHaveBeenCalledOnce();
    expect(eventBridge.commandDisposed).toHaveBeenCalledOnce();
  });

  it("resolves album cover IDs when restored tracks omit artwork", async () => {
    const eventBridge = new MemoryMiniPlayerBridge();
    const localArtworkSource =
      "coda-cover://localhost/v1/600/ca%3A496796527?v=0&s=0123456789abcdef0123456789abcdef";
    const createArtworkSource = vi.fn(() => localArtworkSource);
    const restoredTrack: Track = {
      ...track,
      artworkUrl: undefined,
      coverArt: undefined,
    };
    const view = render(
      <MiniPlayerBridge
        eventBridge={eventBridge}
        track={restoredTrack}
        artwork={{ coverArt: "ca:496796527" }}
        radioTimeline={[]}
        playbackClock={createPlaybackClock(42)}
        playing
        durationSeconds={180}
        volume={0.72}
        canPrevious
        canNext
        onTogglePlayback={vi.fn()}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onSeek={vi.fn()}
        onSetVolume={vi.fn()}
        onShowMain={vi.fn()}
        createArtworkSource={createArtworkSource}
      />,
    );

    await waitFor(() =>
      expect(eventBridge.snapshots.at(-1)?.track?.artworkUrl).toBe(
        localArtworkSource,
      ),
    );
    expect(createArtworkSource).toHaveBeenCalledExactlyOnceWith("ca:496796527");

    view.unmount();
  });
});
