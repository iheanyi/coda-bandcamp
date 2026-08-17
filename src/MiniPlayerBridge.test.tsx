import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MiniPlayerBridge } from "./MiniPlayerBridge";
import {
  MINI_PLAYER_COMMAND_EVENT,
  MINI_PLAYER_REQUEST_STATE_EVENT,
  MINI_PLAYER_STATE_EVENT,
  parseMiniPlayerSnapshot,
  type MiniPlayerSnapshot,
} from "./miniPlayer";
import { createPlaybackClock } from "./playbackClock";
import {
  createMiniPlayerTauriHarness,
  type MiniPlayerTauriHarness,
} from "./test/miniPlayerTauriHarness";
import type { Track } from "./types";

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

let activeHarness: MiniPlayerTauriHarness | undefined;

afterEach(() => {
  cleanup();
  activeHarness?.uninstall();
  activeHarness = undefined;
});

function installMainHarness(): MiniPlayerTauriHarness {
  const harness = createMiniPlayerTauriHarness("main");
  harness.install();
  activeHarness = harness;
  return harness;
}

function emittedSnapshots(
  harness: MiniPlayerTauriHarness,
): MiniPlayerSnapshot[] {
  return harness
    .emittedPayloads(MINI_PLAYER_STATE_EVENT, "mini-player")
    .flatMap((payload) => {
      const snapshot = parseMiniPlayerSnapshot(payload);
      return snapshot ? [snapshot] : [];
    });
}

describe("main-to-mini player bridge", () => {
  it("mirrors the clock, routes bounded commands, and disposes listeners", async () => {
    const harness = installMainHarness();
    const playbackClock = createPlaybackClock(42);
    const onTogglePlayback = vi.fn();
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    const onSeek = vi.fn();
    const onSetVolume = vi.fn();
    const onShowMain = vi.fn();

    const view = render(
      <MiniPlayerBridge
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

    await waitFor(() => expect(emittedSnapshots(harness)).toHaveLength(1));
    expect(emittedSnapshots(harness)[0]).toMatchObject({
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
    expect(JSON.stringify(emittedSnapshots(harness)[0])).not.toContain(
      "signed.mp3",
    );

    act(() => playbackClock.updateFromMedia(43.4));
    await waitFor(() =>
      expect(emittedSnapshots(harness).at(-1)?.positionSeconds).toBe(43),
    );

    act(() => {
      harness.dispatch(MINI_PLAYER_REQUEST_STATE_EVENT, undefined);
    });
    await waitFor(() => expect(emittedSnapshots(harness)).toHaveLength(3));

    act(() => {
      harness.dispatch(MINI_PLAYER_COMMAND_EVENT, { type: "play-pause" });
      harness.dispatch(MINI_PLAYER_COMMAND_EVENT, { type: "previous" });
      harness.dispatch(MINI_PLAYER_COMMAND_EVENT, { type: "next" });
      harness.dispatch(MINI_PLAYER_COMMAND_EVENT, {
        type: "seek",
        positionSeconds: 73,
      });
      harness.dispatch(MINI_PLAYER_COMMAND_EVENT, {
        type: "seek",
        positionSeconds: 181,
      });
      harness.dispatch(MINI_PLAYER_COMMAND_EVENT, {
        type: "volume",
        volume: 0.35,
      });
      harness.dispatch(MINI_PLAYER_COMMAND_EVENT, { type: "show-main" });
      harness.dispatch(MINI_PLAYER_COMMAND_EVENT, {
        type: "volume",
        volume: 4,
      });
      harness.dispatch(MINI_PLAYER_COMMAND_EVENT, null);
      harness.dispatch(
        MINI_PLAYER_COMMAND_EVENT,
        Object.assign(new Date(), {
          [Symbol.toStringTag]: "Object",
          type: "next",
        }),
      );
    });

    expect(onTogglePlayback).toHaveBeenCalledOnce();
    expect(onPrevious).toHaveBeenCalledOnce();
    expect(onNext).toHaveBeenCalledOnce();
    expect(onSeek).toHaveBeenCalledExactlyOnceWith(73);
    expect(onSetVolume).toHaveBeenCalledExactlyOnceWith(0.35);
    expect(onShowMain).toHaveBeenCalledOnce();

    view.unmount();
    await waitFor(() => {
      expect(harness.listenerCount(MINI_PLAYER_REQUEST_STATE_EVENT)).toBe(0);
      expect(harness.listenerCount(MINI_PLAYER_COMMAND_EVENT)).toBe(0);
    });
    expect(harness.unlistenCount(MINI_PLAYER_REQUEST_STATE_EVENT)).toBe(1);
    expect(harness.unlistenCount(MINI_PLAYER_COMMAND_EVENT)).toBe(1);
  });

  it("resolves restored cover IDs through the production artwork boundary", async () => {
    const harness = installMainHarness();
    const restoredTrack: Track = {
      ...track,
      artworkUrl: undefined,
      coverArt: undefined,
    };
    const view = render(
      <MiniPlayerBridge
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
      />,
    );

    await waitFor(() =>
      expect(emittedSnapshots(harness).at(-1)?.track?.artworkUrl).toMatch(
        /^coda-cover:\/\/localhost\/v1\/600\/ca%3A496796527\?v=0&s=[a-f0-9]{32}$/,
      ),
    );
    expect(JSON.stringify(emittedSnapshots(harness).at(-1))).not.toContain(
      "signed.mp3",
    );

    view.unmount();
  });
});
