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
