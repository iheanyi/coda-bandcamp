import type { RadioChapter } from "./types";

export const MAX_RADIO_CHAPTERS = 256;

export type RadioAiringState = {
  current?: RadioChapter;
  next?: RadioChapter;
};

export type RadioAiringIndexes = {
  currentIndex: number;
  nextIndex: number;
};

export function radioShowIdFromTrackId(trackId: string): number | undefined {
  const match = /^radio:([1-9]\d{0,15})$/.exec(trackId);
  if (!match) return undefined;
  const showId = Number(match[1]);
  return Number.isSafeInteger(showId) ? showId : undefined;
}

/**
 * Keeps Radio chapter metadata small and deterministic at the renderer boundary.
 * The stable source index makes the last chapter at a duplicate timecode the one
 * that goes on air, matching a sequence of timestamped chapter transitions.
 */
export function boundRadioChapters(chapters: readonly RadioChapter[]): RadioChapter[] {
  return chapters
    .map((chapter, sourceIndex) => ({ chapter, sourceIndex }))
    .filter(({ chapter }) => Number.isFinite(chapter.timecode) && chapter.timecode >= 0)
    .sort(
      (left, right) =>
        left.chapter.timecode - right.chapter.timecode ||
        left.sourceIndex - right.sourceIndex,
    )
    .slice(0, MAX_RADIO_CHAPTERS)
    .map(({ chapter }) => chapter);
}

export function radioAiringAt(
  chapters: readonly RadioChapter[] | undefined,
  playbackSeconds: number,
): RadioAiringState {
  if (!chapters?.length) return {};

  const timeline = boundRadioChapters(chapters);
  return radioAiringAtTimeline(timeline, playbackSeconds);
}

/**
 * Selects chapter indexes from an already bounded, time-ordered timeline.
 * Duplicate timestamps resolve to the final chapter at that timestamp.
 */
export function radioAiringIndexesAt(
  timeline: readonly RadioChapter[],
  playbackSeconds: number,
): RadioAiringIndexes {
  if (!timeline.length) return { currentIndex: -1, nextIndex: -1 };

  const position = Number.isFinite(playbackSeconds)
    ? Math.max(0, playbackSeconds)
    : 0;
  let low = 0;
  let high = timeline.length - 1;
  let currentIndex = -1;
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    if (timeline[middle].timecode <= position) {
      currentIndex = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  const nextIndex = currentIndex + 1 < timeline.length
    ? currentIndex + 1
    : -1;
  return { currentIndex, nextIndex };
}

export function radioAiringAtTimeline(
  timeline: readonly RadioChapter[],
  playbackSeconds: number,
): RadioAiringState {
  const { currentIndex, nextIndex } = radioAiringIndexesAt(
    timeline,
    playbackSeconds,
  );
  return {
    ...(currentIndex >= 0 ? { current: timeline[currentIndex] } : {}),
    ...(nextIndex >= 0 ? { next: timeline[nextIndex] } : {}),
  };
}

export function nextRadioChapterTime(
  chapters: readonly RadioChapter[] | undefined,
  playbackSeconds: number,
): number | undefined {
  if (!chapters?.length) return undefined;
  return nextRadioChapterTimeInTimeline(
    boundRadioChapters(chapters),
    playbackSeconds,
  );
}

export function nextRadioChapterTimeInTimeline(
  timeline: readonly RadioChapter[],
  playbackSeconds: number,
): number | undefined {
  const { nextIndex } = radioAiringIndexesAt(timeline, playbackSeconds);
  return nextIndex >= 0 ? timeline[nextIndex].timecode : undefined;
}

export function previousRadioChapterTime(
  chapters: readonly RadioChapter[] | undefined,
  playbackSeconds: number,
  restartThresholdSeconds = 4,
): number | undefined {
  if (!chapters?.length) return undefined;
  return previousRadioChapterTimeInTimeline(
    boundRadioChapters(chapters),
    playbackSeconds,
    restartThresholdSeconds,
  );
}

export function previousRadioChapterTimeInTimeline(
  timeline: readonly RadioChapter[],
  playbackSeconds: number,
  restartThresholdSeconds = 4,
): number | undefined {
  if (!timeline.length) return undefined;
  const position = Number.isFinite(playbackSeconds)
    ? Math.max(0, playbackSeconds)
    : 0;
  const { currentIndex } = radioAiringIndexesAt(timeline, position);
  if (currentIndex < 0) return undefined;
  const currentStart = timeline[currentIndex].timecode;
  if (position - currentStart > Math.max(0, restartThresholdSeconds)) {
    return currentStart;
  }
  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    if (timeline[index].timecode < currentStart) return timeline[index].timecode;
  }
  return undefined;
}
