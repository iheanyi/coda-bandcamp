import { useCallback, useSyncExternalStore } from "react";
import type { PlaybackClock } from "@/playbackClock";
import { nextRadioChapterIndex, radioAiringIndexesAt } from "@/radioPlayback";
import type { RadioChapter } from "@/types";

export function usePlaybackPosition(playbackClock: PlaybackClock): number {
  return useSyncExternalStore(
    playbackClock.subscribe,
    playbackClock.getSnapshot,
    playbackClock.getSnapshot,
  );
}

export type CurrentRadioChapterState = {
  current?: RadioChapter;
  next?: RadioChapter;
  currentIndex: number;
  nextIndex: number;
};

export function useCurrentRadioChapter(
  playbackClock: PlaybackClock,
  timeline: readonly RadioChapter[],
): CurrentRadioChapterState {
  const getCurrentIndex = useCallback(
    () =>
      radioAiringIndexesAt(timeline, playbackClock.getSnapshot()).currentIndex,
    [playbackClock, timeline],
  );
  const currentIndex = useSyncExternalStore(
    playbackClock.subscribe,
    getCurrentIndex,
    getCurrentIndex,
  );
  const current = currentIndex >= 0 ? timeline[currentIndex] : undefined;
  const nextIndex = nextRadioChapterIndex(currentIndex, timeline.length);
  const next = nextIndex >= 0 ? timeline[nextIndex] : undefined;
  return { current, next, currentIndex, nextIndex };
}
