import { describe, expect, it, vi } from "vitest";
import { resolveSurprise } from "./surpriseMe";
import type { Album, Track } from "./types";

const album = (id: string, songCount: number): Album => ({
  id,
  title: `Album ${id}`,
  artist: "Test Artist",
  songCount,
  duration: songCount * 180,
  palette: ["#111", "#222"],
});

const track = (albumId: string, index: number): Track => ({
  id: `${albumId}-track-${index}`,
  title: `Track ${index}`,
  artist: "Test Artist",
  album: `Album ${albumId}`,
  albumId,
  duration: 180,
  track: index,
  palette: ["#111", "#222"],
});

describe("Surprise Me", () => {
  it("queues a complete multi-track release in album order", async () => {
    const single = album("single", 1);
    const release = album("release", 3);
    const releaseTracks = [track(release.id, 1), track(release.id, 2)];
    const loadTracks = vi.fn(async (candidate: Album) =>
      candidate.id === release.id ? releaseTracks : [track(single.id, 1)]
    );

    const result = await resolveSurprise([single, release], {
      loadTracks,
      random: () => 0,
      selectTracks: () => [],
    });

    expect(result).toEqual({
      kind: "album",
      album: release,
      queue: releaseTracks,
    });
    expect(loadTracks).toHaveBeenCalledOnce();
    expect(loadTracks).toHaveBeenCalledWith(release);
  });

  it("weights the track branch by release size and queues one track", async () => {
    const single = album("single", 1);
    const release = album("release", 3);
    const releaseTracks = [
      track(release.id, 1),
      track(release.id, 2),
      track(release.id, 3),
    ];
    const loadTracks = vi.fn(async (candidate: Album) =>
      candidate.id === release.id ? releaseTracks : [track(single.id, 1)]
    );
    const randomValues = [0.75, 0.9, 0.2, 0.6];

    const result = await resolveSurprise([single, release], {
      loadTracks,
      random: () => randomValues.shift() ?? 0,
    });

    expect(result).toEqual({
      kind: "track",
      album: release,
      queue: [releaseTracks[1]],
    });
    expect(loadTracks).toHaveBeenCalledOnce();
    expect(loadTracks).toHaveBeenCalledWith(release);
  });

  it("skips releases without a scoped track and tries the next candidate", async () => {
    const first = album("first", 1);
    const second = album("second", 1);
    const firstTrack = track(first.id, 1);
    const secondTrack = track(second.id, 1);
    const randomValues = [0, 0.9, 0];
    const loadTracks = vi.fn(async (candidate: Album) =>
      candidate.id === first.id ? [firstTrack] : [secondTrack]
    );

    const result = await resolveSurprise([first, second], {
      loadTracks,
      random: () => randomValues.shift() ?? 0,
      selectTracks: (candidate, candidateTracks) =>
        candidate.id === first.id ? [] : candidateTracks,
    });

    expect(result).toEqual({
      kind: "track",
      album: second,
      queue: [secondTrack],
    });
    expect(loadTracks).toHaveBeenCalledTimes(2);
  });

  it("bounds retries when releases are unavailable", async () => {
    const candidates = Array.from(
      { length: 9 },
      (_, index) => album(`unavailable-${index}`, 1),
    );
    const loadTracks = vi.fn(async () => {
      throw new Error("Unavailable");
    });

    await expect(resolveSurprise(candidates, {
      loadTracks,
      random: () => 0,
    })).resolves.toBeUndefined();
    expect(loadTracks).toHaveBeenCalledTimes(6);
  });

  it("does not return a stale choice after the library session changes", async () => {
    const release = album("release", 2);
    let active = true;

    const result = await resolveSurprise([release], {
      loadTracks: async () => {
        active = false;
        return [track(release.id, 1), track(release.id, 2)];
      },
      random: () => 0,
      isActive: () => active,
    });

    expect(result).toBeUndefined();
  });
});
