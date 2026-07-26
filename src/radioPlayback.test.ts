import { describe, expect, it } from "vitest";
import {
  boundRadioChapters,
  MAX_RADIO_CHAPTERS,
  nextRadioChapterTime,
  previousRadioChapterTime,
  radioAiringAt,
  radioShowIdFromTrackId,
} from "./radioPlayback";
import type { RadioChapter } from "./types";

const chapters: RadioChapter[] = [
  { title: "Opening", artist: "Bandcamp Radio", timecode: 15 },
  { title: "Mirage", artist: "Sweeps", album: "Mirage", timecode: 45 },
  { title: "Night Drive", artist: "Keylime", timecode: 120 },
];

describe("radioAiringAt", () => {
  it("returns the first upcoming chapter before the first timestamp", () => {
    expect(radioAiringAt(chapters, 4)).toEqual({
      next: chapters[0],
    });
  });

  it("returns the currently airing and next chapters within the show", () => {
    expect(radioAiringAt(chapters, 60)).toEqual({
      current: chapters[1],
      next: chapters[2],
    });
  });

  it("keeps the final chapter current after its timestamp", () => {
    expect(radioAiringAt(chapters, 9_999)).toEqual({
      current: chapters[2],
    });
  });

  it("returns no chapter state for an empty timeline", () => {
    expect(radioAiringAt([], 20)).toEqual({});
    expect(radioAiringAt(undefined, 20)).toEqual({});
  });

  it("uses the last chapter at a duplicate timestamp and skips duplicates for next", () => {
    const duplicateTimeline: RadioChapter[] = [
      { title: "Station ID", artist: "Bandcamp Radio", timecode: 0 },
      { title: "First version", artist: "Artist A", timecode: 30 },
      { title: "Corrected version", artist: "Artist B", timecode: 30 },
      { title: "Later", artist: "Artist C", timecode: 70 },
    ];

    expect(radioAiringAt(duplicateTimeline, 30)).toEqual({
      current: duplicateTimeline[2],
      next: duplicateTimeline[3],
    });
  });
});

describe("boundRadioChapters", () => {
  it("orders valid chapters without mutating the input and caps metadata", () => {
    const many = Array.from({ length: MAX_RADIO_CHAPTERS + 8 }, (_, index) => ({
      title: `Track ${index}`,
      artist: "Artist",
      timecode: MAX_RADIO_CHAPTERS + 8 - index,
    }));
    const originalFirst = many[0];
    const result = boundRadioChapters([
      { title: "Invalid", artist: "Artist", timecode: Number.NaN },
      ...many,
    ]);

    expect(result).toHaveLength(MAX_RADIO_CHAPTERS);
    expect(result[0].timecode).toBe(1);
    expect(many[0]).toBe(originalFirst);
  });
});

describe("Radio chapter transport", () => {
  it("moves Next to the next distinct chapter, including before the show starts", () => {
    expect(nextRadioChapterTime(chapters, 4)).toBe(15);
    expect(nextRadioChapterTime(chapters, 45)).toBe(120);
    expect(nextRadioChapterTime(chapters, 9_999)).toBeUndefined();
  });

  it("restarts the current chapter or moves to the previous one near its start", () => {
    expect(previousRadioChapterTime(chapters, 70)).toBe(45);
    expect(previousRadioChapterTime(chapters, 47)).toBe(15);
    expect(previousRadioChapterTime(chapters, 16)).toBeUndefined();
  });

  it("skips duplicate timecodes so transport cannot get stuck", () => {
    const duplicateTimeline: RadioChapter[] = [
      { title: "First", artist: "Artist A", timecode: 30 },
      { title: "Correction", artist: "Artist B", timecode: 30 },
      { title: "Later", artist: "Artist C", timecode: 70 },
    ];

    expect(nextRadioChapterTime(duplicateTimeline, 30)).toBe(70);
    expect(previousRadioChapterTime(duplicateTimeline, 71)).toBe(30);
  });
});

describe("radioShowIdFromTrackId", () => {
  it("extracts a safe numeric Radio show identifier", () => {
    expect(radioShowIdFromTrackId("radio:979")).toBe(979);
    expect(radioShowIdFromTrackId("radio:1234567890123456")).toBe(1_234_567_890_123_456);
  });

  it("rejects malformed, zero, and unsafe identifiers", () => {
    expect(radioShowIdFromTrackId("track:979")).toBeUndefined();
    expect(radioShowIdFromTrackId("radio:0")).toBeUndefined();
    expect(radioShowIdFromTrackId("radio:09")).toBeUndefined();
    expect(radioShowIdFromTrackId("radio:not-a-show")).toBeUndefined();
    expect(radioShowIdFromTrackId("radio:9999999999999999")).toBeUndefined();
  });
});
