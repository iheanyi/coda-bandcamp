import {
  nextRadioChapterTimeInTimeline,
  previousRadioChapterTimeInTimeline,
} from "@/radioPlayback";
import type { RadioChapter } from "@/types";

import { PREVIOUS_RESTART_THRESHOLD_SECONDS } from "./constants";

export function positionCanPrevious(
  positionSeconds: number,
  timeline: readonly RadioChapter[],
): boolean {
  return (
    positionSeconds > PREVIOUS_RESTART_THRESHOLD_SECONDS ||
    previousRadioChapterTimeInTimeline(
      timeline,
      positionSeconds,
      PREVIOUS_RESTART_THRESHOLD_SECONDS,
    ) !== undefined
  );
}

export function positionCanNext(
  positionSeconds: number,
  timeline: readonly RadioChapter[],
): boolean {
  return (
    nextRadioChapterTimeInTimeline(timeline, positionSeconds) !== undefined
  );
}

export function queueOrChapterCanPrevious(
  queueCanPrevious: boolean,
  positionSeconds: number,
  timeline: readonly RadioChapter[],
): boolean {
  return queueCanPrevious || positionCanPrevious(positionSeconds, timeline);
}

export function queueOrChapterCanNext(
  queueCanNext: boolean,
  positionSeconds: number,
  timeline: readonly RadioChapter[],
): boolean {
  return queueCanNext || positionCanNext(positionSeconds, timeline);
}
