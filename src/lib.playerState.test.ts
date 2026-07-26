import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayerStateInput } from "./types";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

const radioInput: PlayerStateInput = {
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
  positionSeconds: 121,
  volume: 0.7,
  repeatMode: "off",
  queueOpen: false,
  radioScrobbleProgress: {
    showTrackId: "radio:979",
    activeChapterKey: "60:chapter",
    chapterStartedAt: 0,
    chapterListenedSeconds: 61,
    lastPosition: 121,
    chapterNowPlayingSent: false,
    chapterScrobbleState: "sent",
    showStartedAt: 0,
    showListenedSeconds: 121,
    showScrobbleState: "idle",
    scrobbledChapterKeys: ["60:chapter"],
  },
};

describe("native player-state contract negotiation", () => {
  beforeEach(() => {
    vi.resetModules();
    invokeMock.mockReset();
  });

  it("keeps queue and playhead writes compatible during an older native dev process", async () => {
    invokeMock.mockImplementation((command: string, payload?: unknown) => {
      if (command === "player_state_contract_version") {
        return Promise.reject(new Error("Command not found"));
      }
      if (command === "save_player_state") return Promise.resolve(payload);
      if (command === "checkpoint_player_state") return Promise.resolve(true);
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });
    const { checkpointPlayerState, savePlayerState } = await import("./lib");

    await savePlayerState(radioInput);
    await checkpointPlayerState({
      currentIndex: 0,
      currentTrackId: "radio:979",
      positionSeconds: 125,
      radioScrobbleProgress: {
        ...radioInput.radioScrobbleProgress!,
        lastPosition: 125,
      },
    });

    expect(invokeMock).toHaveBeenCalledWith(
      "save_player_state",
      expect.objectContaining({
        state: expect.not.objectContaining({ radioScrobbleProgress: expect.anything() }),
      }),
    );
    expect(invokeMock).toHaveBeenCalledWith(
      "checkpoint_player_state",
      expect.objectContaining({
        checkpoint: expect.not.objectContaining({
          radioScrobbleProgress: expect.anything(),
        }),
      }),
    );
  });

  it("sends Radio progress when Rust advertises the matching contract", async () => {
    invokeMock.mockImplementation((command: string, payload?: unknown) => {
      if (command === "player_state_contract_version") return Promise.resolve(2);
      if (command === "save_player_state") return Promise.resolve(payload);
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });
    const { savePlayerState } = await import("./lib");

    await savePlayerState(radioInput);

    expect(invokeMock).toHaveBeenCalledWith(
      "save_player_state",
      expect.objectContaining({
        state: expect.objectContaining({
          radioScrobbleProgress: expect.objectContaining({
            showTrackId: "radio:979",
          }),
        }),
      }),
    );
  });
});
