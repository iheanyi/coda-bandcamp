import type { RadioChapter } from "./types";

export const MAX_RADIO_CHAPTERS = 256;

export type RadioAiringState = {
  current?: RadioChapter;
  next?: RadioChapter;
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
  if (!timeline.length) return {};

  const position = Number.isFinite(playbackSeconds)
    ? Math.max(0, playbackSeconds)
    : 0;
  let currentIndex = -1;

  for (let index = 0; index < timeline.length; index += 1) {
    if (timeline[index].timecode > position) break;
    currentIndex = index;
  }

  if (currentIndex < 0) return { next: timeline[0] };

  const current = timeline[currentIndex];
  const next = timeline.find(
    (chapter, index) =>
      index > currentIndex && chapter.timecode > current.timecode,
  );
  return { current, next };
}

export function nextRadioChapterTime(
  chapters: readonly RadioChapter[] | undefined,
  playbackSeconds: number,
): number | undefined {
  if (!chapters?.length) return undefined;
  const position = Number.isFinite(playbackSeconds)
    ? Math.max(0, playbackSeconds)
    : 0;
  return boundRadioChapters(chapters)
    .find((chapter) => chapter.timecode > position)
    ?.timecode;
}

export function previousRadioChapterTime(
  chapters: readonly RadioChapter[] | undefined,
  playbackSeconds: number,
  restartThresholdSeconds = 4,
): number | undefined {
  if (!chapters?.length) return undefined;
  const timeline = boundRadioChapters(chapters);
  const position = Number.isFinite(playbackSeconds)
    ? Math.max(0, playbackSeconds)
    : 0;
  let currentStart: number | undefined;

  for (const chapter of timeline) {
    if (chapter.timecode > position) break;
    currentStart = chapter.timecode;
  }
  if (currentStart === undefined) return undefined;
  if (position - currentStart > Math.max(0, restartThresholdSeconds)) {
    return currentStart;
  }
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    if (timeline[index].timecode < currentStart) return timeline[index].timecode;
  }
  return undefined;
}
