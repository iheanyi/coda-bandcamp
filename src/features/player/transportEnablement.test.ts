import { describe, expect, it } from "vitest";

import type { RadioChapter } from "@/types";

import { PREVIOUS_RESTART_THRESHOLD_SECONDS } from "./constants";
import {
  positionCanNext,
  positionCanPrevious,
  queueOrChapterCanNext,
  queueOrChapterCanPrevious,
} from "./transportEnablement";

function chapter(timecode: number): RadioChapter {
  return {
    title: `Chapter ${timecode}`,
    artist: "Signal Garden",
    timecode,
  };
}

describe("transport enablement", () => {
  const timeline = [chapter(0), chapter(45), chapter(120)];

  it("enables previous after the restart threshold or a prior chapter", () => {
    expect(positionCanPrevious(0, [])).toBe(false);
    expect(
      positionCanPrevious(PREVIOUS_RESTART_THRESHOLD_SECONDS, []),
    ).toBe(false);
    expect(
      positionCanPrevious(PREVIOUS_RESTART_THRESHOLD_SECONDS + 0.1, []),
    ).toBe(true);
    expect(positionCanPrevious(16, timeline)).toBe(true);
  });

  it("enables next only when a later chapter exists", () => {
    expect(positionCanNext(0, [])).toBe(false);
    expect(positionCanNext(4, timeline)).toBe(true);
    expect(positionCanNext(9_999, timeline)).toBe(false);
  });

  it("enables skip when the queue or a chapter can move", () => {
    expect(queueOrChapterCanPrevious(true, 0, [])).toBe(true);
    expect(queueOrChapterCanPrevious(false, 0, [])).toBe(false);
    expect(queueOrChapterCanPrevious(false, 16, timeline)).toBe(true);
    expect(queueOrChapterCanNext(true, 9_999, timeline)).toBe(true);
    expect(queueOrChapterCanNext(false, 9_999, timeline)).toBe(false);
    expect(queueOrChapterCanNext(false, 4, timeline)).toBe(true);
  });
});
