import { describe, expect, it, vi } from "vitest";
import {
  installMediaSessionTrackHandlers,
  showAirPlayPicker,
  supportsAirPlayPicker,
  syncMediaSessionPlayback,
} from "./media";

describe("AirPlay capability detection", () => {
  it("uses the native WebKit playback target picker when available", () => {
    const picker = vi.fn();
    const media = document.createElement("audio");
    Object.defineProperty(media, "webkitShowPlaybackTargetPicker", {
      configurable: true,
      value: picker,
    });
    expect(supportsAirPlayPicker(media)).toBe(true);
    expect(showAirPlayPicker(media)).toBe(true);
    expect(picker).toHaveBeenCalledOnce();
  });

  it("stays hidden on platforms without a native picker", () => {
    const media = document.createElement("audio");
    expect(supportsAirPlayPicker(media)).toBe(false);
    expect(showAirPlayPicker(media)).toBe(false);
  });
});

describe("system media controls", () => {
  it("advertises track navigation instead of 15-second seeking", () => {
    const registered = new Map<
      MediaSessionAction,
      MediaSessionActionHandler | null
    >();
    const setActionHandler = vi.fn(
      (
        action: MediaSessionAction,
        handler: MediaSessionActionHandler | null,
      ) => {
        registered.set(action, handler);
      },
    );
    const descriptor = Object.getOwnPropertyDescriptor(
      navigator,
      "mediaSession",
    );
    Object.defineProperty(navigator, "mediaSession", {
      configurable: true,
      value: { setActionHandler },
    });

    try {
      const onPlay = vi.fn();
      const onPause = vi.fn();
      const onPreviousTrack = vi.fn();
      const onNextTrack = vi.fn();
      const dispose = installMediaSessionTrackHandlers({
        onPlay,
        onPause,
        onPreviousTrack,
        onNextTrack,
      });

      expect(registered.get("seekbackward")).toBeNull();
      expect(registered.get("seekforward")).toBeNull();
      registered.get("play")?.({ action: "play" });
      registered.get("pause")?.({ action: "pause" });
      registered.get("previoustrack")?.({ action: "previoustrack" });
      registered.get("nexttrack")?.({ action: "nexttrack" });
      expect(onPlay).toHaveBeenCalledOnce();
      expect(onPause).toHaveBeenCalledOnce();
      expect(onPreviousTrack).toHaveBeenCalledOnce();
      expect(onNextTrack).toHaveBeenCalledOnce();

      dispose();
      expect(registered.get("play")).toBeNull();
      expect(registered.get("pause")).toBeNull();
      expect(registered.get("previoustrack")).toBeNull();
      expect(registered.get("nexttrack")).toBeNull();
    } finally {
      if (descriptor) {
        Object.defineProperty(navigator, "mediaSession", descriptor);
      } else {
        Reflect.deleteProperty(navigator, "mediaSession");
      }
    }
  });

  it("publishes the active Coda track and playback state", () => {
    class MemoryMediaSession {
      metadata: MediaMetadata | null = null;
      playbackState: MediaSessionPlaybackState = "none";
      setActionHandler = vi.fn<MediaSession["setActionHandler"]>();
      setPositionState = vi.fn<MediaSession["setPositionState"]>();
    }
    class MockMediaMetadata {
      static instances: MockMediaMetadata[] = [];

      constructor(readonly init: MediaMetadataInit) {
        MockMediaMetadata.instances.push(this);
      }
    }
    const mediaSession = new MemoryMediaSession();
    const navigatorDescriptor = Object.getOwnPropertyDescriptor(
      navigator,
      "mediaSession",
    );
    const metadataDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "MediaMetadata",
    );
    Object.defineProperty(navigator, "mediaSession", {
      configurable: true,
      value: mediaSession,
    });
    Object.defineProperty(globalThis, "MediaMetadata", {
      configurable: true,
      value: MockMediaMetadata,
    });

    try {
      syncMediaSessionPlayback({
        title: "First Light",
        artist: "Night Archive",
        album: "Soft Focus",
        artworkUrl: "https://t4.bcbits.com/img/cover.jpg",
        playing: true,
        positionSeconds: 42,
        durationSeconds: 180,
      });

      expect(mediaSession.playbackState).toBe("playing");
      expect(MockMediaMetadata.instances[0]?.init).toEqual({
        title: "First Light",
        artist: "Night Archive",
        album: "Soft Focus",
        artwork: [{ src: "https://t4.bcbits.com/img/cover.jpg" }],
      });
      expect(mediaSession.setPositionState).toHaveBeenCalledExactlyOnceWith({
        duration: 180,
        playbackRate: 1,
        position: 42,
      });
    } finally {
      if (navigatorDescriptor) {
        Object.defineProperty(
          navigator,
          "mediaSession",
          navigatorDescriptor,
        );
      } else {
        Reflect.deleteProperty(navigator, "mediaSession");
      }
      if (metadataDescriptor) {
        Object.defineProperty(
          globalThis,
          "MediaMetadata",
          metadataDescriptor,
        );
      } else {
        Reflect.deleteProperty(globalThis, "MediaMetadata");
      }
    }
  });
});
