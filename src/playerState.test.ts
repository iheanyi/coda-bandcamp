import { describe, expect, it } from "vitest";
import {
  createPlayerState,
  createPlayerStateCheckpoint,
  MAX_PERSISTED_QUEUE_LENGTH,
  parsePlayerState,
  PLAYER_STATE_CONTRACT_VERSION,
  stripTrackForPersistence,
} from "./playerState";
import radioContract from "../test/fixtures/player-state-radio-contract.json";
import type {
  PlayerStateCheckpoint,
  PlayerStateInput,
  Track,
} from "./types";

const track: Track = {
  id: "track-1",
  title: "Afterimage",
  artist: "Night Archive",
  album: "Soft Focus",
  albumId: "album-1",
  duration: 210,
  track: 2,
  coverArt: "cover-1",
  artworkUrl: "https://f4.bcbits.com/img/a123_10.jpg",
  streamUrl: "https://bandcamp.com/api/subsonic/rest/stream.view?u=fan&t=signed",
  palette: ["#cf6046", "#2f2624"],
};

const input: PlayerStateInput = {
  queue: [track],
  currentIndex: 0,
  positionSeconds: 42,
  volume: 0.72,
  repeatMode: "all",
  queueOpen: true,
  lastFmProgress: {
    trackId: "track-1",
    startedAt: 1_700_000_000,
    listenedSeconds: 40,
    lastPosition: 42,
    nowPlayingSent: true,
    scrobbleState: "sent",
  },
};

describe("player state persistence", () => {
  it("matches the shared native Radio persistence contract", () => {
    expect(radioContract.contractVersion).toBe(PLAYER_STATE_CONTRACT_VERSION);
    const snapshot = parsePlayerState(radioContract.snapshot);
    expect(snapshot).toMatchObject({
      queue: [{ id: "radio:979" }],
      positionSeconds: 121,
      radioScrobbleProgress: {
        showTrackId: "radio:979",
        chapterStartedAt: 0,
        chapterScrobbleState: "sent",
        scrobbledChapterKeys: ["60:chapter"],
      },
    });
    expect(
      createPlayerStateCheckpoint(
        radioContract.checkpoint as unknown as PlayerStateCheckpoint,
      ),
    ).toMatchObject({
      currentTrackId: "radio:979",
      radioScrobbleProgress: { showTrackId: "radio:979" },
    });
  });

  it("creates a versioned snapshot without signed stream URLs", () => {
    const state = createPlayerState(input, 1_700_000_000_000);

    expect(state.version).toBe(1);
    expect(state.savedAt).toBe(1_700_000_000_000);
    expect(state.queue[0]).not.toHaveProperty("streamUrl");
    expect(JSON.stringify(state)).not.toContain("signed");
    expect(state.queue[0]).not.toHaveProperty("artworkUrl");
  });

  it("strips all artwork URLs while retaining the refreshable cover ID", () => {
    const persisted = stripTrackForPersistence({
      ...track,
      artworkUrl: "https://bandcamp.com/api/subsonic/rest/getCoverArt.view?u=fan&t=token",
    });
    expect(persisted).not.toHaveProperty("artworkUrl");
    expect(persisted.coverArt).toBe("cover-1");
    expect(
      stripTrackForPersistence({ ...track, artworkUrl: "data:image/png;base64,secret" }),
    ).not.toHaveProperty("artworkUrl");
  });

  it("normalizes nullable optional fields from native Subsonic payloads", () => {
    const state = createPlayerState({
      ...input,
      queue: [
        {
          ...track,
          disc: null,
          coverArt: null,
        } as unknown as Track,
      ],
    });

    expect(state.queue[0]).not.toHaveProperty("disc");
    expect(state.queue[0]).not.toHaveProperty("coverArt");
  });

  it("omits Discover previews but preserves refreshable Radio shows", () => {
    const state = createPlayerState({
      ...input,
      queue: [
        { ...track, id: "discover:featured" },
        { ...track, id: "radio:979" },
        { ...track, id: "library-track" },
      ],
      currentIndex: 1,
      positionSeconds: 30,
      lastFmProgress: undefined,
    });

    expect(state.queue.map(({ id }) => id)).toEqual(["radio:979", "library-track"]);
    expect(state.currentIndex).toBe(0);
    expect(state.positionSeconds).toBe(30);
    expect(state.queue[0]).not.toHaveProperty("streamUrl");
    expect(state.queue[0]).not.toHaveProperty("artworkUrl");
    expect(state.queue[0]).not.toHaveProperty("radioChapters");
  });

  it("rejects control characters in queue metadata and palettes", () => {
    expect(() => createPlayerState({ ...input, queue: [{ ...track, title: "Bad\nTitle" }] }))
      .toThrow(/invalid/);
    expect(() =>
      createPlayerState({ ...input, queue: [{ ...track, palette: ["#fff\u007f", "#000"] }] }),
    ).toThrow(/invalid/);
    expect(() => createPlayerState({ ...input, queue: [{ ...track, track: 100_001 }] }))
      .toThrow(/invalid/);
  });

  it("normalizes in-flight Last.fm work conservatively for a paused restore", () => {
    const state = createPlayerState({
      ...input,
      lastFmProgress: {
        ...input.lastFmProgress!,
        nowPlayingSent: true,
        scrobbleState: "pending",
      },
    });

    expect(state.lastFmProgress).toMatchObject({
      listenedSeconds: 40,
      startedAt: 0,
      nowPlayingSent: false,
      scrobbleState: "sent",
    });
  });

  it("restores bounded Radio scrobble progress without chapter metadata", () => {
    const state = createPlayerState({
      ...input,
      queue: [{ ...track, id: "radio:979", radioChapters: [
        { title: "First light", artist: "North Star", timecode: 60 },
      ] }],
      lastFmProgress: undefined,
      radioScrobbleProgress: {
        showTrackId: "radio:979",
        activeChapterKey: "60:chapter",
        chapterStartedAt: 1_700_000_000,
        chapterListenedSeconds: 61,
        lastPosition: 121,
        chapterNowPlayingSent: true,
        chapterScrobbleState: "pending",
        showStartedAt: 1_700_000_000,
        showListenedSeconds: 121,
        showScrobbleState: "idle",
        scrobbledChapterKeys: [],
      },
    });

    expect(state.queue[0]).not.toHaveProperty("radioChapters");
    expect(state.radioScrobbleProgress).toMatchObject({
      showTrackId: "radio:979",
      chapterStartedAt: 0,
      chapterNowPlayingSent: false,
      chapterScrobbleState: "sent",
      showStartedAt: 0,
      scrobbledChapterKeys: ["60:chapter"],
    });
    expect(JSON.stringify(state)).not.toContain("First light");
  });

  it("rejects malformed, out-of-range, and mismatched snapshots", () => {
    const valid = createPlayerState(input);
    expect(parsePlayerState({ ...valid, version: 2 })).toBeUndefined();
    expect(parsePlayerState({ ...valid, currentIndex: 2 })).toBeUndefined();
    expect(parsePlayerState({ ...valid, volume: Number.NaN })).toBeUndefined();
    expect(
      parsePlayerState({
        ...valid,
        lastFmProgress: { ...valid.lastFmProgress, trackId: "another-track" },
      }),
    ).toBeUndefined();
  });

  it("accepts an empty, paused queue only at position zero", () => {
    const empty = createPlayerState({
      queue: [],
      currentIndex: 0,
      positionSeconds: 0,
      volume: 0.5,
      repeatMode: "off",
      queueOpen: false,
    });
    expect(parsePlayerState(empty)).toEqual(empty);
    expect(parsePlayerState({ ...empty, positionSeconds: 1 })).toBeUndefined();
  });

  it("bounds the persisted queue", () => {
    expect(() =>
      createPlayerState({
        ...input,
        queue: Array.from({ length: MAX_PERSISTED_QUEUE_LENGTH + 1 }, () => track),
      }),
    ).toThrow(/invalid/);
  });

  it("validates lightweight checkpoints against their Last.fm track", () => {
    expect(
      createPlayerStateCheckpoint({
        currentIndex: 0,
        currentTrackId: "track-1",
        positionSeconds: 48,
        lastFmProgress: input.lastFmProgress,
      }),
    ).toMatchObject({ currentTrackId: "track-1", positionSeconds: 48 });
    expect(() =>
      createPlayerStateCheckpoint({
        currentIndex: 0,
        currentTrackId: "track-2",
        positionSeconds: 48,
        lastFmProgress: input.lastFmProgress,
      }),
    ).toThrow(/invalid/);
  });

  it("accepts Radio progress only for the matching Radio checkpoint", () => {
    const radioScrobbleProgress = {
      showTrackId: "radio:979",
      chapterStartedAt: 0,
      chapterListenedSeconds: 25,
      lastPosition: 85,
      chapterNowPlayingSent: false,
      chapterScrobbleState: "idle" as const,
      showStartedAt: 0,
      showListenedSeconds: 85,
      showScrobbleState: "idle" as const,
      scrobbledChapterKeys: [],
    };
    expect(
      createPlayerStateCheckpoint({
        currentIndex: 0,
        currentTrackId: "radio:979",
        positionSeconds: 85,
        radioScrobbleProgress,
      }),
    ).toMatchObject({ currentTrackId: "radio:979", radioScrobbleProgress });
    expect(() =>
      createPlayerStateCheckpoint({
        currentIndex: 0,
        currentTrackId: "track-1",
        positionSeconds: 85,
        radioScrobbleProgress,
      }),
    ).toThrow(/invalid/);
  });
});
