import { describe, expect, it } from "vitest";

import type { Track } from "@/types";
import { createPublicPlaybackQueueProjector } from "./publicQueue";

const track: Track = {
  id: "track-1",
  title: "First light",
  artist: "Example artist",
  album: "Example album",
  albumId: "album-1",
  duration: 180,
  track: 1,
  palette: ["#111111", "#222222"],
  streamUrl: "https://t4.bcbits.com/example?token=fixture",
  radioChapters: [{ title: "Opening", artist: "Example artist", timecode: 0 }],
};

describe("public queue projection", () => {
  it("reuses unchanged tracks through append and reorder without exposing streams", () => {
    const project = createPublicPlaybackQueueProjector();
    const second = { ...track, id: "track-2" };
    const original = [track].map(project);
    const appended = [track, second].map(project);
    const reordered = [second, track].map(project);

    expect(appended[0]).toBe(original[0]);
    expect(reordered[1]).toBe(original[0]);
    expect(reordered[0]).toBe(appended[1]);
    expect(original[0]).not.toHaveProperty("streamUrl");
    expect(original[0].palette).not.toBe(track.palette);
    expect(original[0].radioChapters?.[0]).not.toBe(track.radioChapters?.[0]);
  });

  it("projects replacement metadata even for the same track id and isolates runtimes", () => {
    const project = createPublicPlaybackQueueProjector();
    const original = project(track);
    const replacement = project({ ...track, title: "Updated title" });

    expect(replacement).not.toBe(original);
    expect(replacement.title).toBe("Updated title");
    expect(replacement).not.toHaveProperty("streamUrl");
    expect(original.title).toBe("First light");
    expect(createPublicPlaybackQueueProjector()(track)).not.toBe(original);
  });
});
