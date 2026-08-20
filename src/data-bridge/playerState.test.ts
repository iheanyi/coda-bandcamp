import type { InvokeArgs } from "@tauri-apps/api/core";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlayerState } from "../playerState";
import type { PlayerStateInput } from "../types";

type NativeInvocation = {
  command: string;
  payload: InvokeArgs | undefined;
};

type PlayerStateIpcValue =
  | boolean
  | number
  | string
  | null
  | undefined
  | PlayerStateIpcValue[]
  | PlayerStateIpcRecord;

type PlayerStateIpcRecord = {
  [key: string]: PlayerStateIpcValue;
};

let nativeInvocations: NativeInvocation[] = [];

function recordInvocation(
  command: string,
  payload: InvokeArgs | undefined,
): void {
  nativeInvocations.push({ command, payload });
}

function invocationFor(command: string): NativeInvocation | undefined {
  return nativeInvocations.find((invocation) => invocation.command === command);
}

function isIpcRecord<Value>(
  value: Value,
): value is Value & PlayerStateIpcRecord {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function savedQueueLength(
  invocation: NativeInvocation | undefined,
): number | undefined {
  const payload = invocation?.payload;
  if (!isIpcRecord(payload) || !isIpcRecord(payload.state)) return undefined;
  return Array.isArray(payload.state.queue)
    ? payload.state.queue.length
    : undefined;
}

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
    clearMocks();
    vi.resetModules();
    nativeInvocations = [];
  });

  afterEach(() => {
    clearMocks();
    vi.unstubAllGlobals();
  });

  it("keeps queue and playhead writes compatible during an older native dev process", async () => {
    mockIPC((command, payload) => {
      recordInvocation(command, payload);
      if (command === "player_state_contract_version") {
        return Promise.reject(new Error("Command not found"));
      }
      if (command === "save_player_state") return Promise.resolve();
      if (command === "checkpoint_player_state") return Promise.resolve(true);
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });
    const { checkpointPlayerState, savePlayerState } = await import("./playerState");

    const saving = savePlayerState(radioInput);
    expect(invocationFor("save_player_state")).toBeUndefined();
    await saving;
    await checkpointPlayerState({
      currentIndex: 0,
      currentTrackId: "radio:979",
      positionSeconds: 125,
      radioScrobbleProgress: {
        ...radioInput.radioScrobbleProgress!,
        lastPosition: 125,
      },
    });

    expect(invocationFor("save_player_state")?.payload).toEqual(
      expect.objectContaining({
        state: expect.not.objectContaining({ radioScrobbleProgress: expect.anything() }),
      }),
    );
    expect(invocationFor("checkpoint_player_state")?.payload).toEqual(
      expect.objectContaining({
        checkpoint: expect.not.objectContaining({
          radioScrobbleProgress: expect.anything(),
        }),
      }),
    );
  });

  it("sends Radio progress when Rust advertises the matching contract", async () => {
    mockIPC((command, payload) => {
      recordInvocation(command, payload);
      if (command === "player_state_contract_version") return Promise.resolve(2);
      if (command === "save_player_state") return Promise.resolve();
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });
    const { savePlayerState } = await import("./playerState");

    await savePlayerState(radioInput);

    expect(invocationFor("save_player_state")?.payload).toEqual(
      expect.objectContaining({
        state: expect.objectContaining({
          radioScrobbleProgress: expect.objectContaining({
            showTrackId: "radio:979",
          }),
        }),
      }),
    );
  });

  it("idle-schedules both preparation and native handoff for a maximum-size write", async () => {
    const idleCallbacks: IdleRequestCallback[] = [];
    vi.stubGlobal("requestIdleCallback", vi.fn((callback: IdleRequestCallback) => {
      idleCallbacks.push(callback);
      return idleCallbacks.length;
    }));
    mockIPC((command, payload) => {
      recordInvocation(command, payload);
      if (command === "player_state_contract_version") return Promise.resolve(2);
      if (command === "save_player_state") return Promise.resolve();
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });
    const { savePlayerState } = await import("./playerState");
    const queue = Array.from({ length: 25_000 }, (_, index) => ({
      ...radioInput.queue[0],
      id: `radio:${index + 1}`,
      albumId: `radio:${index + 1}`,
    }));
    const maximumInput: PlayerStateInput = {
      ...radioInput,
      queue,
      radioScrobbleProgress: undefined,
    };

    const saving = savePlayerState(maximumInput);
    expect(idleCallbacks).toHaveLength(1);
    expect(invocationFor("save_player_state")).toBeUndefined();

    idleCallbacks[0]({
      didTimeout: false,
      timeRemaining: () => 12,
    });
    await vi.waitFor(() => expect(idleCallbacks).toHaveLength(2));
    expect(invocationFor("save_player_state")).toBeUndefined();

    idleCallbacks[1]({
      didTimeout: false,
      timeRemaining: () => 12,
    });

    await saving;
    expect(savedQueueLength(invocationFor("save_player_state"))).toBe(25_000);
  });

  it("does not synchronously validate a maximum-size state after native IPC", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    const queue = Array.from({ length: 25_000 }, (_, index) => ({
      ...radioInput.queue[0],
      id: `track-${index}`,
      albumId: `album-${index}`,
    }));
    const snapshot = createPlayerState({
      ...radioInput,
      queue,
      radioScrobbleProgress: undefined,
    }, 1_700_000_000_000);
    mockIPC((command, payload) => {
      recordInvocation(command, payload);
      if (command === "load_player_state") return Promise.resolve(snapshot);
      if (command === "record_player_state_diagnostic") return Promise.resolve();
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });
    const { loadPlayerState } = await import("./playerState");

    const loading = loadPlayerState();
    let settled = false;
    void loading.then(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(settled).toBe(false);
    await expect(loading).resolves.toEqual(snapshot);
  });
});
