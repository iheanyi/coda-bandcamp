import { describe, expect, it } from "vitest";
import type { Album, RadioChapter } from "./types";
import { resolveRadioChapterLibraryTargets } from "./radioNavigation";

const albums: Album[] = [
  {
    id: "mirage",
    title: "Mirage",
    artist: "Sweeps",
    songCount: 2,
    duration: 360,
    palette: ["#765", "#211"],
    tracks: [
      {
        id: "mirage-track",
        title: "Mirage w/ Keylime",
        artist: "Sweeps",
        album: "Mirage",
        albumId: "mirage",
        duration: 180,
        track: 1,
        palette: ["#765", "#211"],
      },
    ],
  },
  {
    id: "compilation",
    title: "Night Signals",
    artist: "Various Artists",
    songCount: 10,
    duration: 1_800,
    palette: ["#456", "#123"],
    tracks: [
      {
        id: "signal-track",
        title: "Second Signal",
        artist: "Night Archive",
        album: "Night Signals",
        albumId: "compilation",
        duration: 180,
        track: 2,
        palette: ["#456", "#123"],
      },
    ],
  },
];

describe("resolveRadioChapterLibraryTargets", () => {
  it("finds an owned artist and release by normalized metadata", () => {
    const chapter: RadioChapter = {
      title: "Mirage w/ Keylime",
      artist: "  SWEEPS ",
      album: "mirage",
      timecode: 30,
    };

    expect(resolveRadioChapterLibraryTargets(chapter, albums)).toEqual({
      artist: "Sweeps",
      album: albums[0],
    });
  });

  it("finds a compilation track without pretending the track artist owns the album", () => {
    const chapter: RadioChapter = {
      title: "second signal",
      artist: "Night Archive",
      timecode: 60,
    };

    expect(resolveRadioChapterLibraryTargets(chapter, albums)).toEqual({
      album: albums[1],
    });
  });

  it("leaves unknown metadata unresolved for the Bandcamp fallback", () => {
    expect(resolveRadioChapterLibraryTargets({
      title: "Unknown Track",
      artist: "Unknown Artist",
      timecode: 90,
    }, albums)).toEqual({});
  });
});
