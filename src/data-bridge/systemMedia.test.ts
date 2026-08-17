import type { InvokeArgs } from "@tauri-apps/api/core";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  updateSystemMediaMetadata,
  updateSystemMediaPlayback,
  updateSystemMediaTimeline,
} from "./systemMedia";

afterEach(() => {
  clearMocks();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  vi.unstubAllGlobals();
});

describe("Windows system-media commands", () => {
  it("no-ops unless the native Windows app is running", async () => {
    mockIPC(() => {
      throw new Error("system media must not invoke off Windows");
    });

    await expect(updateSystemMediaMetadata({
      title: "Afterimage",
      artist: "Night Archive",
      album: "Soft Focus",
      canPrevious: false,
      canNext: true,
    })).resolves.toBeUndefined();
    await expect(updateSystemMediaPlayback(true)).resolves.toBeUndefined();
    await expect(updateSystemMediaTimeline(12, 245)).resolves.toBeUndefined();
  });

  it("invokes fixed native commands on Windows desktop", async () => {
    const invocations: Array<{
      command: string;
      payload: InvokeArgs | undefined;
    }> = [];
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    });
    mockIPC((command, payload) => {
      invocations.push({ command, payload });
      return null;
    });

    await updateSystemMediaMetadata({
      title: "Afterimage",
      artist: "Night Archive",
      album: "Soft Focus",
      artwork: { kind: "cover", coverArtId: "cover-1" },
      canPrevious: true,
      canNext: false,
    });
    await updateSystemMediaPlayback(false);
    await updateSystemMediaTimeline(30, 245);

    expect(invocations).toEqual([
      {
        command: "update_system_media_metadata",
        payload: {
          input: {
            title: "Afterimage",
            artist: "Night Archive",
            album: "Soft Focus",
            artwork: { kind: "cover", coverArtId: "cover-1" },
            canPrevious: true,
            canNext: false,
          },
        },
      },
      {
        command: "update_system_media_playback",
        payload: { playing: false },
      },
      {
        command: "update_system_media_timeline",
        payload: { positionSeconds: 30, durationSeconds: 245 },
      },
    ]);
  });
});
