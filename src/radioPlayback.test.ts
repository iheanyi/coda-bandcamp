import { describe, expect, it } from "vitest";
import {
  boundRadioChapters,
  MAX_RADIO_CHAPTERS,
  nextRadioChapterTimeInTimeline,
  previousRadioChapterTimeInTimeline,
  radioAiringIndexesAt,
  radioShowIdFromTrackId,
} from "./radioPlayback";
import type { RadioChapter } from "./types";

const chapters: RadioChapter[] = [
  { title: "Opening", artist: "Bandcamp Radio", timecode: 15 },
  { title: "Mirage", artist: "Sweeps", album: "Mirage", timecode: 45 },
  { title: "Night Drive", artist: "Keylime", timecode: 120 },
];

describe("radioAiringIndexesAt", () => {
  it("finds current and upcoming chapters across the show timeline", () => {
    const cases = [
      { position: 4, expected: { currentIndex: -1, nextIndex: 0 } },
      { position: 60, expected: { currentIndex: 1, nextIndex: 2 } },
      { position: 9_999, expected: { currentIndex: 2, nextIndex: -1 } },
    ];
    for (const { position, expected } of cases) {
      expect(radioAiringIndexesAt(chapters, position), `${position}s`)
        .toEqual(expected);
    }
    expect(radioAiringIndexesAt([], 20)).toEqual({
      currentIndex: -1,
      nextIndex: -1,
    });
  });

  it("uses the last chapter at a duplicate timestamp and skips duplicates for next", () => {
    const duplicateTimeline = boundRadioChapters([
      { title: "Later", artist: "Artist C", timecode: 70 },
      { title: "Station ID", artist: "Bandcamp Radio", timecode: 0 },
      { title: "First version", artist: "Artist A", timecode: 30 },
      { title: "Corrected version", artist: "Artist B", timecode: 30 },
    ]);

    expect(radioAiringIndexesAt(duplicateTimeline, 30)).toEqual({
      currentIndex: 2,
      nextIndex: 3,
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
    const timeline = boundRadioChapters(chapters);
    expect(nextRadioChapterTimeInTimeline(timeline, 4)).toBe(15);
    expect(nextRadioChapterTimeInTimeline(timeline, 45)).toBe(120);
    expect(nextRadioChapterTimeInTimeline(timeline, 9_999)).toBeUndefined();
  });

  it("restarts the current chapter or moves to the previous one near its start", () => {
    const timeline = boundRadioChapters(chapters);
    expect(previousRadioChapterTimeInTimeline(timeline, 70)).toBe(45);
    expect(previousRadioChapterTimeInTimeline(timeline, 47)).toBe(15);
    expect(previousRadioChapterTimeInTimeline(timeline, 16)).toBeUndefined();
  });

  it("skips duplicate timecodes so transport cannot get stuck", () => {
    const duplicateTimeline: RadioChapter[] = [
      { title: "First", artist: "Artist A", timecode: 30 },
      { title: "Correction", artist: "Artist B", timecode: 30 },
      { title: "Later", artist: "Artist C", timecode: 70 },
    ];

    expect(nextRadioChapterTimeInTimeline(duplicateTimeline, 30)).toBe(70);
    expect(previousRadioChapterTimeInTimeline(duplicateTimeline, 71)).toBe(30);
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
