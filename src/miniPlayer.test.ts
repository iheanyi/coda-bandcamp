import { describe, expect, it } from "vitest";
import type { Track } from "./types";
import {
  createMiniPlayerSnapshot,
  parseMiniPlayerCommand,
  parseMiniPlayerSnapshot,
} from "./miniPlayer";

const track: Track = {
  id: "track-1",
  title: "First Light",
  artist: "Night Archive",
  album: "Soft Focus",
  albumId: "album-1",
  duration: 180,
  track: 1,
  coverArt: "cover-1",
  artworkUrl: "https://t4.bcbits.com/img/cover.jpg",
  streamUrl: "https://t4.bcbits.com/stream/signed.mp3",
  palette: ["#dd6549", "#202326"],
};

describe("mini player event contract", () => {
  it("builds a bounded display snapshot without exposing the signed stream", () => {
    const snapshot = createMiniPlayerSnapshot({
      track,
      display: {
        title: "First Light (Radio edit)",
        artist: "Night Archive",
        artworkUrl: "https://t4.bcbits.com/img/chapter.jpg",
      },
      playing: true,
      positionSeconds: 42.25,
      durationSeconds: 180,
      volume: 0.72,
      canPrevious: true,
      canNext: false,
    });

    expect(snapshot).toEqual({
      track: {
        id: "track-1",
        title: "First Light (Radio edit)",
        artist: "Night Archive",
        album: "Soft Focus",
        artworkUrl: "https://t4.bcbits.com/img/chapter.jpg",
        palette: ["#dd6549", "#202326"],
      },
      playing: true,
      positionSeconds: 42.25,
      durationSeconds: 180,
      volume: 0.72,
      canPrevious: true,
      canNext: false,
    });
    expect(JSON.stringify(snapshot)).not.toContain("signed.mp3");
    expect(JSON.stringify(snapshot)).not.toContain("cover-1");
  });

  it("keeps missing release metadata empty across the compact-window boundary", () => {
    const snapshot = createMiniPlayerSnapshot({
      track: { ...track, album: "Unknown release" },
      playing: false,
      positionSeconds: 0,
      durationSeconds: 180,
      volume: 0.72,
      canPrevious: false,
      canNext: false,
    });

    expect(snapshot.track?.album).toBe("");
    expect(parseMiniPlayerSnapshot(snapshot)).toEqual(snapshot);
  });

  it("validates unknown snapshots before the compact window renders them", () => {
    const valid = createMiniPlayerSnapshot({
      track,
      playing: false,
      positionSeconds: 12,
      durationSeconds: 180,
      volume: 0.5,
      canPrevious: false,
      canNext: true,
    });

    expect(parseMiniPlayerSnapshot(valid)).toEqual(valid);
    expect(
      parseMiniPlayerSnapshot({ ...valid, volume: Number.NaN }),
    ).toBeUndefined();
    expect(parseMiniPlayerSnapshot({ ...valid, volume: 2 })).toBeUndefined();
    expect(
      parseMiniPlayerSnapshot({
        ...valid,
        track: { ...valid.track, title: "x".repeat(513) },
      }),
    ).toBeUndefined();
    expect(
      parseMiniPlayerSnapshot({
        ...valid,
        positionSeconds: 181,
      }),
    ).toBeUndefined();
    expect(
      parseMiniPlayerSnapshot({
        ...valid,
        track: { ...valid.track, palette: ["coral", "#202326"] },
      }),
    ).toBeUndefined();
    expect(
      parseMiniPlayerSnapshot({
        ...valid,
        track: { ...valid.track, palette: ["#fffff", "#202326"] },
      }),
    ).toBeUndefined();
    expect(
      parseMiniPlayerSnapshot({
        ...valid,
        track: { ...valid.track, title: "First\nLight" },
      }),
    ).toBeUndefined();
  });

  it("accepts only exact local cover protocol sources", () => {
    const valid = createMiniPlayerSnapshot({
      track,
      display: {
        artworkUrl:
          "coda-cover://localhost/v1/600/ca%3A496796527?v=revision_1&s=0123456789abcdef0123456789abcdef",
      },
      playing: false,
      positionSeconds: 0,
      durationSeconds: 180,
      volume: 0.5,
      canPrevious: false,
      canNext: false,
    });
    expect(parseMiniPlayerSnapshot(valid)).toEqual(valid);

    const windows = {
      ...valid,
      track: {
        ...valid.track,
        artworkUrl:
          "http://coda-cover.localhost/v1/600/ca%3A496796527?v=revision_1&s=0123456789abcdef0123456789abcdef",
      },
    };
    expect(parseMiniPlayerSnapshot(windows)).toEqual(windows);

    for (const artworkUrl of [
      "coda-cover://evil/v1/600/ca%3A496796527?v=revision_1&s=0123456789abcdef0123456789abcdef",
      "coda-cover://localhost/v1/1200/ca%3A496796527?v=revision_1&s=0123456789abcdef0123456789abcdef",
      "coda-cover://localhost/v1/600/ca%3A496796527",
      "coda-cover://localhost/v1/600/ca%3A496796527?v=revision_1",
      "coda-cover://localhost/v1/600/ca%3A496796527?v=bad%20revision&s=0123456789abcdef0123456789abcdef",
      "coda-cover://localhost/v1/600/ca%3A496796527?v=revision_1&s=bad-scope",
      "coda-cover://localhost/v1/600/../secret?v=revision_1&s=0123456789abcdef0123456789abcdef",
      "http://example.test/v1/600/ca%3A496796527?v=revision_1&s=0123456789abcdef0123456789abcdef",
      "asset://localhost/private/cover.jpg",
    ]) {
      expect(
        parseMiniPlayerSnapshot({
          ...valid,
          track: { ...valid.track, artworkUrl },
        }),
      ).toBeUndefined();
    }
  });

  it("bounds fallback track metadata before emitting it", () => {
    const snapshot = createMiniPlayerSnapshot({
      track: {
        ...track,
        title: `${"x".repeat(600)}\u0000`,
      },
      playing: false,
      positionSeconds: 0,
      durationSeconds: 180,
      volume: 0.5,
      canPrevious: false,
      canNext: false,
    });

    expect(snapshot.track?.title).toHaveLength(512);
    expect(snapshot.track?.title).not.toContain("\u0000");
  });

  it("accepts only bounded compact-player commands", () => {
    expect(parseMiniPlayerCommand({ type: "play-pause" })).toEqual({
      type: "play-pause",
    });
    expect(parseMiniPlayerCommand({ type: "previous" })).toEqual({
      type: "previous",
    });
    expect(parseMiniPlayerCommand({ type: "next" })).toEqual({ type: "next" });
    expect(parseMiniPlayerCommand({ type: "show-main" })).toEqual({
      type: "show-main",
    });
    expect(
      parseMiniPlayerCommand({ type: "seek", positionSeconds: 73.5 }),
    ).toEqual({ type: "seek", positionSeconds: 73.5 });
    expect(parseMiniPlayerCommand({ type: "volume", volume: 0.35 })).toEqual({
      type: "volume",
      volume: 0.35,
    });

    expect(
      parseMiniPlayerCommand({ type: "seek", positionSeconds: -1 }),
    ).toBeUndefined();
    expect(
      parseMiniPlayerCommand({ type: "seek", positionSeconds: Number.NaN }),
    ).toBeUndefined();
    expect(
      parseMiniPlayerCommand({ type: "volume", volume: 1.01 }),
    ).toBeUndefined();
    expect(
      parseMiniPlayerCommand({ type: "queue-everything" }),
    ).toBeUndefined();
  });
});
